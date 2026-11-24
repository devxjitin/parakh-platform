import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

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

const get = (who: Token, url: string) => ctx.http().get(url).set(auth(who));
const post = (who: Token, url: string, body: object = {}) =>
  ctx.http().post(url).set(auth(who)).send(body);
const del = (who: Token, password = PASSWORD) => post(who, '/users/me/delete', { password });

/** A student who joined, started the exam and answered one question. */
async function studentWithAttempt(email = 'sam@example.com') {
  const sam = await newStudent(ctx, email);
  const enrollmentId = await joinExam(ctx, sam, exam.code);
  const attempt = (await post(sam, '/attempts', { enrollmentId }).expect(200)).body;
  await ctx
    .http()
    .put(`/attempts/${attempt.id}/answers/${exam.questionIds.single}`)
    .set(auth(sam))
    .send({ selected: [0] })
    .expect(200);
  return { sam, attemptId: attempt.id as string };
}
const finish = (attemptId: string) =>
  ctx.prisma.attempt.update({
    where: { id: attemptId },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  });

describe('download my data', () => {
  it('returns the student their own data as a file, without secrets', async () => {
    const { sam } = await studentWithAttempt();
    const res = await get(sam, '/users/me/data').expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const data = JSON.parse(res.text);
    expect(data.account).toMatchObject({ email: 'sam@example.com', role: 'STUDENT' });
    expect(data.enrollments).toHaveLength(1);
    expect(data.attempts[0].exam).toBe('Cloud Fundamentals');
    expect(data.attempts[0].answers[0]).toMatchObject({
      question: 'What is IaaS?',
      selectedOptions: [0],
    });
    expect(data.attempts[0].startIp).toBeTruthy();
    expect(data.payments[0]).toMatchObject({ purpose: 'EXAM_JOIN', amountPaise: 14_900 });
    // Never any secret, and never someone else's data.
    expect(res.text).not.toMatch(/passwordHash|argon2|codeHash|tokenHash/);
    expect(res.text).not.toContain('trainer@example.com');
  });

  it('gives a trainer their exams and a masked bank account only', async () => {
    await ctx
      .http()
      .put('/me/payout-details')
      .set(auth(trainer))
      .send({
        method: 'BANK',
        accountName: 'Tara Trainer',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
      })
      .expect(200);
    const res = await get(trainer, '/users/me/data').expect(200);
    const data = JSON.parse(res.text);
    expect(data.examsYouCreated[0].title).toBe('Cloud Fundamentals');
    expect(data.examsYouCreated[0].questions).toHaveLength(3);
    expect(data.trainerProfile).toMatchObject({ bankAccountEnding: '9012' });
    expect(res.text).not.toContain('123456789012');
    await ctx.http().get('/users/me/data').expect(401);
  });
});

describe('close my account (student)', () => {
  it('asks a trainer for the right password, never an admin, and a student needs none', async () => {
    await del(trainer, 'Wrong-password-1').expect(403);
    expect(
      (await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'trainer@example.com' } }))
        .deletedAt,
    ).toBeNull();
    const admin = await createAdmin(ctx);
    await del(admin).expect(403);
    // a student has no password: they proved their email in this visit
    const { sam, attemptId } = await studentWithAttempt();
    await finish(attemptId);
    await del(sam).expect(200);
  });

  it('is refused while an exam is being taken', async () => {
    const { sam, attemptId } = await studentWithAttempt();
    const res = await del(sam).expect(409);
    expect(res.body.message).toMatch(/Finish or submit/);
    await finish(attemptId);
    await del(sam).expect(200);
  });

  it('wipes who they are, keeps the money and certificate records, and shuts the door', async () => {
    const { sam, attemptId } = await studentWithAttempt();
    await finish(attemptId);
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'sam@example.com' } });
    ctx.mail.clear();

    const res = await del(sam).expect(200);
    expect(res.body).toEqual({ deleted: true });
    expect(ctx.mail.lastTo('sam@example.com')?.subject).toMatch(/closed/i);

    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({
      name: 'Deleted user',
      email: `deleted-${before.id}@deleted.invalid`,
      phone: null,
      status: 'SUSPENDED',
    });
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.passwordHash).not.toBe(before.passwordHash);

    // Records that must stay are still there, now tied to the anonymous account.
    expect(await ctx.prisma.payment.count({ where: { userId: before.id } })).toBe(1);
    expect(await ctx.prisma.enrollment.count({ where: { studentId: before.id } })).toBe(1);
    expect(await ctx.prisma.ledgerEntry.count()).toBeGreaterThan(0);
    const attempt = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt).toMatchObject({ startIp: null, lastIp: null, userAgent: null, deviceId: null });
    expect(await ctx.prisma.answer.count({ where: { attemptId } })).toBe(1);
    expect(await ctx.prisma.refreshToken.count({ where: { userId: before.id } })).toBe(0);

    // The audit log keeps the id but not the old name or email.
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'account.delete' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('sam@example.com');

    // Nobody can sign in as them any more, with the old token or the old credentials.
    await get(sam, '/users/me').expect(401);
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'sam@example.com', password: PASSWORD })
      .expect(401);

    // The email address is free again: it can be registered fresh, as a brand-new account.
    const again = await signUp(ctx, { role: 'STUDENT', email: 'sam@example.com' });
    await get(again, '/users/me').expect(200);
    expect(await ctx.prisma.enrollment.count({ where: { studentId: before.id } })).toBe(1);
  });

  it('keeps a seat reserved for the deleted email locked, not open to anyone', async () => {
    // An assigned seat can predate the current sponsor-at-publish flow.
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { examId: exam.examId } });
    const pack = await ctx.prisma.seatPack.create({
      data: { examId: exam.examId, sponsorId: payment.userId, paymentId: payment.id, seats: 1 },
    });
    await ctx.prisma.seat.create({
      data: { packId: pack.id, email: 'lee@example.com', token: 'historical-seat' },
    });
    const lee = await newStudent(ctx, 'lee@example.com');
    await del(lee).expect(200);
    const seat = await ctx.prisma.seat.findFirstOrThrow({});
    expect(seat.email).toMatch(/^deleted-.*@deleted\.invalid$/);
  });
});

describe('close my account (trainer)', () => {
  it('is refused while an exam is open or upcoming', async () => {
    const res = await del(trainer).expect(409);
    expect(res.body.message).toMatch(/open or upcoming/);
  });

  it('is refused while earnings are unpaid, then works once the exam is over and nothing is owed', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() - 60_000), startsAt: new Date(Date.now() - 3_600_000) },
    });
    const owed = await del(trainer).expect(409);
    expect(owed.body.message).toMatch(/not been paid out/);

    // The student is refunded in full, so nothing is owed to the trainer any more.
    const admin = await createAdmin(ctx);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { purpose: 'EXAM_JOIN' } });
    await post(admin, `/admin/finance/payments/${payment.id}/refund`, {
      reason: 'test refund',
    }).expect(200);
    await ctx
      .http()
      .put('/me/payout-details')
      .set(auth(trainer))
      .send({ method: 'UPI', upiId: 'tara@okbank' })
      .expect(200);

    const trainerId = (
      await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'trainer@example.com' } })
    ).id;
    await del(trainer).expect(200);
    const gone = await ctx.prisma.user.findUniqueOrThrow({ where: { id: trainerId } });
    expect(gone.deletedAt).toBeInstanceOf(Date);
    expect(await ctx.prisma.examinerProfile.count({ where: { userId: gone.id } })).toBe(0);
    // Their exam and its payment records stay.
    expect(await ctx.prisma.exam.count({ where: { id: exam.examId } })).toBe(1);
    expect(await ctx.prisma.payment.count({ where: { examId: exam.examId } })).toBeGreaterThan(0);
  });
});
