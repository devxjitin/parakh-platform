import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';
import { AttemptSweeperService } from '../results/attempt-sweeper.service';
import { CertificatesService } from '../certificates/certificates.service';

type Token = { accessToken: string };

let ctx: TestContext;
let trainer: Token;
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
  exam = await publishExam(ctx, trainer);
});

const post = (who: Token, url: string, body: object = {}) =>
  ctx.http().post(url).set(auth(who)).send(body);
describe('duplicate exam', () => {
  it('copies settings, questions and certificate design but not code, payment or dates', async () => {
    const res = await post(trainer, `/exams/${exam.examId}/duplicate`).expect(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      code: null,
      startsAt: null,
      endsAt: null,
      title: 'Copy of Cloud Fundamentals',
      questionCount: 3,
    });
    expect(res.body.questions.map((q: { body: string }) => q.body)).toEqual([
      'What is IaaS?',
      'Pick public clouds',
      'Explain shared responsibility',
    ]);
    expect(await ctx.prisma.payment.count({ where: { examId: res.body.id } })).toBe(0);
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await post(other, `/exams/${exam.examId}/duplicate`).expect(404);
    // the copy is a normal draft that can be edited and deleted without touching the original
    await ctx.http().delete(`/exams/${res.body.id}`).set(auth(trainer)).expect(204);
    expect(await ctx.prisma.question.count({ where: { examId: exam.examId } })).toBe(3);
  });
});

describe('overdue sweeper', () => {
  it('ends and marks overdue attempts across all exams without anyone opening Results', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    const a = (await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200))
      .body;
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [0] })
      .expect(200);
    await ctx.prisma.attempt.update({
      where: { id: a.id },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });
    expect(await ctx.app.get(AttemptSweeperService).sweep()).toBe(1);
    const row = await ctx.prisma.attempt.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'GRADED', endReason: 'TIME_UP', score: 2 });
    expect(await ctx.app.get(AttemptSweeperService).sweep()).toBe(0);
  });
});

describe('certificate PDF retry', () => {
  async function failedCert(attempts: number, nextAt: Date | null) {
    const holder = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'trainer@example.com' },
    });
    return ctx.prisma.certificate.create({
      data: {
        examId: exam.examId,
        studentId: holder.id,
        serialNo: `PRK-TEST-${attempts}-${Math.floor(Math.random() * 1e6)}`,
        kind: 'TRAINER',
        holderName: 'Tara Trainer',
        examTitle: 'Cloud Fundamentals',
        scorePercent: 0,
        issuedOn: new Date(),
        verifyHash: 'x',
        pdfError: 'boom',
        pdfAttempts: attempts,
        pdfNextAt: nextAt,
      },
    });
  }

  it('retries after the wait, not before, and gives up after 3 tries until an admin regenerates', async () => {
    const waiting = await failedCert(1, new Date(Date.now() + 60_000));
    const due = await failedCert(1, new Date(Date.now() - 1000));
    const gaveUp = await failedCert(3, new Date(Date.now() - 1000));
    const svc = ctx.app.get(CertificatesService);
    await svc.runOnce();
    const row = (id: string) => ctx.prisma.certificate.findUniqueOrThrow({ where: { id } });
    expect((await row(due.id)).pdfKey).not.toBeNull();
    expect((await row(waiting.id)).pdfKey).toBeNull();
    expect((await row(gaveUp.id)).pdfKey).toBeNull();

    const admin = await createAdmin(ctx);
    await post(admin, `/admin/certificates/${gaveUp.id}/regenerate`).expect(200);
    await svc.runOnce();
    expect((await row(gaveUp.id)).pdfKey).not.toBeNull();
    await post(admin, `/admin/certificates/${gaveUp.id}/regenerate`).expect(409); // already has it
  });
});

describe('payment after the window passed', () => {
  it('does not publish, flags the payment for refund and emails the trainer', async () => {
    const fresh = await publishExam(ctx, trainer, {});
    const draft = (
      await post(trainer, '/exams', {
        title: 'Late payer',
        durationMinutes: 30,
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 7_200_000).toISOString(),
      }).expect(201)
    ).body;
    await post(trainer, `/exams/${draft.id}/questions`, {
      type: 'SINGLE',
      body: 'Q?',
      options: ['A', 'B'],
      correctOptions: [0],
    }).expect(201);
    const order = (await post(trainer, `/exams/${draft.id}/publish-order`).expect(200)).body;
    await ctx.prisma.exam.update({
      where: { id: draft.id },
      data: {
        startsAt: new Date(Date.now() - 7_200_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    const paid = (
      await post(trainer, '/payments/fake/complete', { orderId: order.orderId }).expect(200)
    ).body;
    ctx.mail.clear();
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(paid).expect(200);
    expect((await ctx.prisma.exam.findUnique({ where: { id: draft.id } }))?.status).toBe('DRAFT');
    expect(
      (await ctx.prisma.payment.findFirstOrThrow({ where: { examId: draft.id } })).needsRefund,
    ).toBe(true);
    expect(ctx.mail.outbox.some((m) => /was not published: its closing time/.test(m.subject))).toBe(
      true,
    );
    expect(fresh.examId).toBeTruthy();
  });
});
