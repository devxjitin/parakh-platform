import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };
let admin: { accessToken: string };
let exam: PublishedExam;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  const a = await createAdmin(ctx);
  admin = { accessToken: a.accessToken };
  exam = await publishExam(ctx, trainer);
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const post = (url: string, who: { accessToken: string }, body: object = {}) =>
  ctx.http().post(url).set(auth(who)).send(body);

describe('extend', () => {
  it('is no longer available once an exam is published', async () => {
    await post(`/exams/${exam.examId}/extend`, trainer, { endsAt: hours(5) }).expect(404);
  });
});

describe('close', () => {
  it('stops new students from joining and starting, and reports who is still sitting', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200);

    const res = await post(`/exams/${exam.examId}/close`, trainer).expect(200);
    expect(res.body.stillRunning).toBe(1);

    const lena = await newStudent(ctx, 'lena@example.com');
    await ctx.http().post(`/join/${exam.code}/order`).set(auth(lena)).expect(409);
    await post(`/exams/${exam.examId}/close`, trainer).expect(409); // already closed
  });
});

describe('cancel', () => {
  it('cancels the exam, refunds no one, keeps every payment, and blocks joining', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, sam, exam.code);
    await joinExam(ctx, lena, exam.code);

    const res = await post(`/exams/${exam.examId}/cancel`, trainer, {
      reason: 'Venue unavailable',
    }).expect(200);
    expect(res.body).toEqual({ status: 'CANCELLED', students: 2 });

    // Fees are not refundable, even when the exam is cancelled.
    expect(
      await ctx.prisma.payment.count({ where: { examId: exam.examId, status: 'CAPTURED' } }),
    ).toBe(3);
    expect(
      await ctx.prisma.payment.count({
        where: { examId: exam.examId, status: { in: ['REFUNDED', 'PENDING_REFUND'] } },
      }),
    ).toBe(0);
    expect(await ctx.prisma.enrollment.count({ where: { examId: exam.examId } })).toBe(2);
    expect((await ctx.prisma.exam.findUnique({ where: { id: exam.examId } }))?.status).toBe(
      'CANCELLED',
    );

    // Both paid students are told, with the reason and the no-refund rule.
    await vi.waitFor(() => {
      for (const who of ['sam@example.com', 'lena@example.com']) {
        const mail = ctx.mail.lastTo(who);
        expect(mail?.subject).toBe('Exam cancelled: Cloud Fundamentals');
        expect(mail?.text).toContain('Venue unavailable');
        expect(mail?.text).toContain('not refunded');
      }
    });
    await vi.waitFor(async () => {
      const log = await ctx.prisma.auditLog.findFirst({
        where: { action: 'exam.cancel.notified' },
      });
      expect(log?.meta).toMatchObject({ sent: 2, total: 2 });
    });

    const late = await newStudent(ctx, 'late@example.com');
    await ctx.http().post(`/join/${exam.code}/order`).set(auth(late)).expect(404);
    await post(`/exams/${exam.examId}/cancel`, trainer, { reason: 'Again please' }).expect(409);
  });

  it('refuses once someone has started, unless forced; nobody is refunded either way', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const lena = await newStudent(ctx, 'lena@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    await joinExam(ctx, lena, exam.code);
    await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200);

    await post(`/exams/${exam.examId}/cancel`, trainer, { reason: 'Something came up' }).expect(
      409,
    );
    const res = await post(`/exams/${exam.examId}/cancel`, trainer, {
      reason: 'Something came up',
      force: true,
    }).expect(200);
    expect(res.body).toEqual({ status: 'CANCELLED', students: 2 });
    expect(
      await ctx.prisma.payment.count({ where: { examId: exam.examId, status: 'REFUNDED' } }),
    ).toBe(0);
  });

  it('does not email a student whose account is suspended', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, sam, exam.code);
    await joinExam(ctx, lena, exam.code);
    await ctx.prisma.user.update({
      where: { email: 'lena@example.com' },
      data: { status: 'SUSPENDED' },
    });
    ctx.mail.clear();
    await post(`/exams/${exam.examId}/cancel`, trainer, { reason: 'Venue unavailable' }).expect(
      200,
    );
    await vi.waitFor(async () => {
      const log = await ctx.prisma.auditLog.findFirst({
        where: { action: 'exam.cancel.notified' },
      });
      expect(log?.meta).toMatchObject({ sent: 1, total: 2 });
    });
    expect(ctx.mail.lastTo('sam@example.com')?.subject).toMatch(/Exam cancelled/);
    expect(ctx.mail.lastTo('lena@example.com')).toBeUndefined();
  });

  it('needs a written reason', async () => {
    await post(`/exams/${exam.examId}/cancel`, trainer, { reason: 'no' }).expect(400);
  });
});

describe('admin suspend', () => {
  it("stops another trainer's exam without refunding; trainers cannot use it", async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    await post(`/admin/exams/${exam.examId}/suspend`, trainer, { reason: 'Fraud report' }).expect(
      403,
    );
    const res = await post(`/admin/exams/${exam.examId}/suspend`, admin, {
      reason: 'Fraud report confirmed',
    }).expect(200);
    expect(res.body).toEqual({ status: 'CANCELLED', students: 1 });
    await vi.waitFor(() =>
      expect(ctx.mail.lastTo('sam@example.com')?.text).toContain('Fraud report confirmed'),
    );
    expect(
      await ctx.prisma.payment.count({ where: { examId: exam.examId, status: 'REFUNDED' } }),
    ).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'exam.suspend' } })).toBe(1);
  });
});
