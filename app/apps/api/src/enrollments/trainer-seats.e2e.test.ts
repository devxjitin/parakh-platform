import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, lastCode, signUp } from '../../test/helpers';
import { auth } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function draftExam() {
  const exam = (
    await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Seat Exam', durationMinutes: 30, startsAt: hours(-1), endsAt: hours(3) })
      .expect(201)
  ).body;
  await ctx
    .http()
    .post(`/exams/${exam.id}/questions`)
    .set(auth(trainer))
    .send({ type: 'SINGLE', body: 'Q?', options: ['a', 'b'], correctOptions: [0], marks: 2 })
    .expect(201);
  return exam.id as string;
}

async function publishWith(examId: string, body: object) {
  const order = (
    await ctx
      .http()
      .post(`/exams/${examId}/publish-order`)
      .set(auth(trainer))
      .send(body)
      .expect(200)
  ).body;
  const paid = (
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(trainer))
      .send({ orderId: order.orderId })
      .expect(200)
  ).body;
  const done = (await ctx.http().post('/payments/verify').set(auth(trainer)).send(paid).expect(200))
    .body;
  return { order, code: done.exam.code as string };
}

async function joinAs(code: string, email: string) {
  const start = await ctx
    .http()
    .post(`/auth/join/${code}/start`)
    .send({ name: 'Asha Rao', email, acceptTerms: true });
  if (start.status !== 202) return { start };
  const res = await ctx
    .http()
    .post('/auth/join/verify')
    .send({ name: 'Asha Rao', email, code: lastCode(ctx.mail, email) })
    .expect(200);
  return { start, token: { accessToken: res.body.accessToken as string } };
}

describe('trainer buys seats when publishing', () => {
  it('charges the publish fee plus one join fee per listed email, and emails each student', async () => {
    const id = await draftExam();
    const { order, code } = await publishWith(id, {
      studentEmails: ['Asha@Example.com', 'ravi@example.com', 'asha@example.com'],
    });
    // 199 + 2 x 149, the duplicate email is one seat
    expect(order.amountPaise).toBe(19900 + 2 * 14900);
    const seats = await ctx.prisma.seat.findMany({ where: { pack: { examId: id } } });
    expect(seats.map((s) => s.email).sort()).toEqual(['asha@example.com', 'ravi@example.com']);
    for (const email of ['asha@example.com', 'ravi@example.com']) {
      const mail = ctx.mail.lastTo(email);
      expect(mail?.subject).toMatch(/You are invited to/);
      expect(mail?.text).toContain(code);
      expect(mail?.text).toContain(`/join/?code=${code}`);
      expect(mail?.text).toMatch(/Total marks: \d+/);
      // students are never told a seat was bought for them
      expect(`${mail?.subject} ${mail?.text}`).not.toMatch(
        /\b(paid|bought|reserved|sponsor\w*)\b/i,
      );
    }
    // all of it is NandiVex's money, and the books still balance
    const entries = await ctx.prisma.ledgerEntry.findMany({ where: { examId: id } });
    expect(entries.some((e) => e.account.startsWith('EXAMINER:'))).toBe(false);
    expect(entries.reduce((s, e) => s + e.amountPaise, 0)).toBe(0);
  });

  it('lets only the listed emails in, free, once each; nobody else gets a code', async () => {
    const id = await draftExam();
    const { code } = await publishWith(id, { studentEmails: ['asha@example.com'] });

    const info = (await ctx.http().get(`/join/${code}`).expect(200)).body;
    expect(info).toMatchObject({ sponsored: true, feePaise: 0 });

    // an email that is not on the list is refused before any code is sent
    ctx.mail.clear();
    await ctx
      .http()
      .post(`/auth/join/${code}/start`)
      .send({ name: 'Eve', email: 'eve@example.com', acceptTerms: true })
      .expect(403);
    expect(ctx.mail.lastTo('eve@example.com')).toBeUndefined();

    const asha = await joinAs(code, 'asha@example.com');
    await ctx.http().post(`/join/${code}/order`).set(auth(asha.token!)).expect(409);
    const seat = (await ctx.http().post(`/join/${code}/enroll`).set(auth(asha.token!)).expect(200))
      .body;
    expect(seat.enrollmentId).toBeTruthy();
    expect(await ctx.prisma.payment.count({ where: { purpose: 'EXAM_JOIN' } })).toBe(0);
    const row = await ctx.prisma.seat.findFirstOrThrow({ where: { pack: { examId: id } } });
    expect(row.redeemedAt).not.toBeNull();
    expect(row.enrollmentId).toBe(seat.enrollmentId);
  });

  it('keeps the normal students-pay mode when no emails are given', async () => {
    const id = await draftExam();
    const { order, code } = await publishWith(id, {});
    expect(order.amountPaise).toBe(19900);
    expect(await ctx.prisma.seat.count()).toBe(0);
    expect((await ctx.http().get(`/join/${code}`).expect(200)).body).toMatchObject({
      sponsored: false,
      feePaise: 14900,
    });
  });

  it('rejects a bad address or the trainer own email in the list', async () => {
    const id = await draftExam();
    await ctx
      .http()
      .post(`/exams/${id}/publish-order`)
      .set(auth(trainer))
      .send({ studentEmails: ['not-an-email'] })
      .expect(400);
    await ctx
      .http()
      .post(`/exams/${id}/publish-order`)
      .set(auth(trainer))
      .send({ studentEmails: ['trainer@example.com'] })
      .expect(400);
  });
});
