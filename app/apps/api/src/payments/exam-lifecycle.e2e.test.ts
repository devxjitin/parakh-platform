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

describe('reschedule', () => {
  const when = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const url = () => `/exams/${exam.examId}/reschedule`;

  beforeEach(async () => {
    // A scheduled exam that has not opened yet (the default fixture is already open).
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: {
        startsAt: new Date(Date.now() + 6 * 3_600_000),
        endsAt: new Date(Date.now() + 9 * 3_600_000),
      },
    });
  });

  it('moves an exam nobody started, keeps every seat, and emails the joined students', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    await ctx.prisma.enrollment.updateMany({
      where: { examId: exam.examId },
      data: { reminderSentAt: new Date() },
    });
    ctx.mail.clear();

    const res = await post(url(), trainer, { startsAt: when(48), endsAt: when(72) }).expect(200);
    expect(res.body.notified).toBe(1);
    const row = await ctx.prisma.exam.findUniqueOrThrow({ where: { id: exam.examId } });
    expect(row.startsAt?.toISOString()).toBe(res.body.startsAt);
    expect(row.endsAt?.toISOString()).toBe(res.body.endsAt);
    expect(row.status).toBe('PUBLISHED');
    // the seat stays, and the "starts soon" reminder can go out again for the new time
    const seat = await ctx.prisma.enrollment.findFirstOrThrow({ where: { examId: exam.examId } });
    expect(seat.reminderSentAt).toBeNull();
    await vi.waitFor(() =>
      expect(ctx.mail.lastTo('sam@example.com')?.subject).toBe('New time for Cloud Fundamentals'),
    );
  });

  it('closes after the exam duration when no closing time is given', async () => {
    const res = await post(url(), trainer, { startsAt: when(48) }).expect(200);
    const ms = new Date(res.body.endsAt).getTime() - new Date(res.body.startsAt).getTime();
    expect(ms).toBe(60 * 60_000);
  });

  it('refuses a past start, a window shorter than the exam, other trainers and started exams', async () => {
    await post(url(), trainer, { startsAt: when(-1) }).expect(400);
    await post(url(), trainer, { startsAt: when(48), endsAt: when(48.2) }).expect(400);
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await post(url(), other, { startsAt: when(48) }).expect(404);

    const sam = await newStudent(ctx, 'sam@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 7_200_000) },
    });
    await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200);
    await post(url(), trainer, { startsAt: when(48) }).expect(409);
  });
});

describe('close before the start', () => {
  it('is refused, so paid students are never locked out', async () => {
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: {
        startsAt: new Date(Date.now() + 3_600_000),
        endsAt: new Date(Date.now() + 7_200_000),
      },
    });
    const res = await post(`/exams/${exam.examId}/close`, trainer).expect(409);
    expect(res.body.message).toMatch(/not started yet/);
  });
});

describe('cancel', () => {
  it('cancels the exam, refunds every unstarted student, keeps the creation fee, and blocks joining', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, sam, exam.code);
    await joinExam(ctx, lena, exam.code);

    const res = await post(`/exams/${exam.examId}/cancel`, trainer, {
      reason: 'Venue unavailable',
    }).expect(200);
    expect(res.body).toEqual({ status: 'CANCELLED', students: 2, refunding: 2 });

    // Both join fees go back (and their trainer share with them); the creation fee stays.
    await vi.waitFor(async () => {
      expect(
        await ctx.prisma.payment.count({
          where: { examId: exam.examId, purpose: 'EXAM_JOIN', status: 'REFUNDED' },
        }),
      ).toBe(2);
    });
    expect(
      await ctx.prisma.payment.count({ where: { examId: exam.examId, status: 'CAPTURED' } }),
    ).toBe(1);
    expect((await ctx.prisma.exam.findUnique({ where: { id: exam.examId } }))?.status).toBe(
      'CANCELLED',
    );

    // Both paid students are told, with the reason and the no-refund rule.
    await vi.waitFor(() => {
      for (const who of ['sam@example.com', 'lena@example.com']) {
        const mail = ctx.mail.outbox.find(
          (m) => m.to === who && m.subject.startsWith('Exam cancelled'),
        );
        expect(
          ctx.mail.outbox.some(
            (m) => m.to === who && m.subject === 'Exam cancelled: Cloud Fundamentals',
          ),
        ).toBe(true);
        expect(mail?.text).toContain('Venue unavailable');
        expect(mail?.text).toContain('refunded in full');
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

  it('refuses once someone has started, unless forced; only the student who had not started is refunded', async () => {
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
    expect(res.body).toEqual({ status: 'CANCELLED', students: 2, refunding: 1 });
    await vi.waitFor(async () => {
      const refunded = await ctx.prisma.payment.findMany({
        where: { examId: exam.examId, status: 'REFUNDED' },
        include: { user: { select: { email: true } } },
      });
      // Lena had not started and is refunded; Sam sat the exam and is not.
      expect(refunded.map((p) => p.user.email)).toEqual(['lena@example.com']);
    });
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
    // A suspended student gets no cancellation email (the refund notice is separate).
    expect(
      ctx.mail.outbox.some((m) => m.to === 'lena@example.com' && /^Exam cancelled/.test(m.subject)),
    ).toBe(false);
  });

  it('needs a written reason', async () => {
    await post(`/exams/${exam.examId}/cancel`, trainer, { reason: 'no' }).expect(400);
  });
});

describe('admin suspend', () => {
  it("stops another trainer's exam and refunds unstarted students; trainers cannot use it", async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    await post(`/admin/exams/${exam.examId}/suspend`, trainer, { reason: 'Fraud report' }).expect(
      403,
    );
    const res = await post(`/admin/exams/${exam.examId}/suspend`, admin, {
      reason: 'Fraud report confirmed',
    }).expect(200);
    expect(res.body).toEqual({ status: 'CANCELLED', students: 1, refunding: 1 });
    await vi.waitFor(async () =>
      expect(
        await ctx.prisma.payment.count({ where: { examId: exam.examId, status: 'REFUNDED' } }),
      ).toBe(1),
    );
    await vi.waitFor(() =>
      expect(
        ctx.mail.outbox.some(
          (m) => m.to === 'sam@example.com' && m.text.includes('Fraud report confirmed'),
        ),
      ).toBe(true),
    );
    expect(await ctx.prisma.auditLog.count({ where: { action: 'exam.suspend' } })).toBe(1);
  });
});
