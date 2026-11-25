import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { FakePaymentProvider } from './provider';
import { generateExamCode } from './payments.service';

let ctx: TestContext;
let trainer: { accessToken: string; email: string };
let other: { accessToken: string };
let student: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, {
    role: 'EXAMINER',
    email: 'trainer@example.com',
    name: 'Tara Trainer',
  });
  other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
  student = await signUp(ctx, { role: 'STUDENT', email: 'student@example.com' });
});

const auth = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function readyExam(token = trainer, extra: object = {}) {
  const res = await ctx
    .http()
    .post('/exams')
    .set(auth(token))
    .send({
      title: 'Cloud Fundamentals',
      durationMinutes: 60,
      startsAt: days(1),
      endsAt: days(2),
      ...extra,
    })
    .expect(201);
  await ctx
    .http()
    .post(`/exams/${res.body.id}/questions`)
    .set(auth(token))
    .send({ type: 'SINGLE', body: 'What is IaaS?', options: ['A', 'B'], correctOptions: [0] })
    .expect(201);
  return res.body.id as string;
}

async function order(examId: string, token = trainer) {
  const res = await ctx.http().post(`/exams/${examId}/publish-order`).set(auth(token)).expect(200);
  return res.body as {
    orderId: string;
    amountPaise: number;
    provider: string;
    keyId: string | null;
  };
}

async function checkout(orderId: string, token = trainer) {
  const res = await ctx
    .http()
    .post('/payments/fake/complete')
    .set(auth(token))
    .send({ orderId })
    .expect(200);
  return res.body as { orderId: string; paymentId: string; signature: string };
}

function webhook(
  event: string,
  orderId: string,
  paymentId: string,
  amount: number,
  eventId: string,
) {
  const body = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'x' } } },
  });
  return ctx
    .http()
    .post('/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', eventId)
    .set('x-razorpay-signature', FakePaymentProvider.signWebhook(body))
    .send(body);
}

describe('publishing prerequisites', () => {
  it('is for trainers who own the exam', async () => {
    const id = await readyExam();
    await ctx.http().post(`/exams/${id}/publish-order`).expect(401);
    await ctx.http().post(`/exams/${id}/publish-order`).set(auth(student)).expect(403);
    await ctx.http().post(`/exams/${id}/publish-order`).set(auth(other)).expect(404);
  });

  it('lists what is missing', async () => {
    const empty = await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Empty exam' })
      .expect(201);
    const res = await ctx
      .http()
      .post(`/exams/${empty.body.id}/publish-order`)
      .set(auth(trainer))
      .expect(400);
    expect(res.body.problems).toHaveLength(2); // no questions, no window
    expect(await ctx.prisma.payment.count()).toBe(0);
  });

  it('rejects a start time that has passed, even when the exam has not closed yet', async () => {
    // Made 10 minutes ahead, then publishing took too long: the start is already behind us.
    const late = await readyExam(trainer, {
      durationMinutes: 30,
      startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    const res = await ctx
      .http()
      .post(`/exams/${late}/publish-order`)
      .set(auth(trainer))
      .expect(400);
    expect(res.body.message).toContain('start time has already passed');
    expect(await ctx.prisma.payment.count()).toBe(0);
  });

  it('rejects a window in the past or shorter than the duration', async () => {
    const past = await readyExam(trainer, { startsAt: days(-3), endsAt: days(-2) });
    await ctx.http().post(`/exams/${past}/publish-order`).set(auth(trainer)).expect(400);
    const tight = await readyExam(trainer, {
      durationMinutes: 120,
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    const res = await ctx
      .http()
      .post(`/exams/${tight}/publish-order`)
      .set(auth(trainer))
      .expect(400);
    expect(res.body.message).toContain('shorter than the exam duration');
  });
});

describe('paying to publish', () => {
  it('creates a 199 rupee order and resumes it instead of duplicating', async () => {
    const id = await readyExam();
    const a = await order(id);
    expect(a).toMatchObject({ amountPaise: 19900, provider: 'fake', keyId: null });
    const b = await order(id);
    expect(b.orderId).toBe(a.orderId);
    expect(await ctx.prisma.payment.count()).toBe(1);
  });

  it('publishes after a verified payment, with a code, a receipt and one email', async () => {
    const id = await readyExam();
    const o = await order(id);
    const c = await checkout(o.orderId);
    const res = await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);

    expect(res.body.exam).toMatchObject({ id, status: 'PUBLISHED' });
    expect(res.body.exam.code).toMatch(/^NVX-[A-HJKMNP-Z2-9]{6}$/);
    expect(res.body.receiptNo).toMatch(/^PRK-R-\d{6}$/);

    const detail = await ctx.http().get(`/exams/${id}`).set(auth(trainer)).expect(200);
    expect(detail.body).toMatchObject({ status: 'PUBLISHED', code: res.body.exam.code });
    expect(detail.body.publishedAt).toBeTruthy();

    const mails = ctx.mail.outbox.filter(
      (m) => m.to === 'trainer@example.com' && m.subject.includes('Receipt'),
    );
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain(res.body.exam.code);
    expect(mails[0].text).toContain('INR 199.00');

    // A published exam is locked.
    await ctx
      .http()
      .patch(`/exams/${id}`)
      .set(auth(trainer))
      .send({ title: 'Changed' })
      .expect(409);
    await ctx.http().post(`/exams/${id}/publish-order`).set(auth(trainer)).expect(409);
  });

  it('is idempotent: verifying twice keeps one code and sends one email', async () => {
    const id = await readyExam();
    const c = await checkout((await order(id)).orderId);
    const first = await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);
    const second = await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);
    expect(second.body.exam.code).toBe(first.body.exam.code);
    expect(second.body.receiptNo).toBe(first.body.receiptNo);
    expect(ctx.mail.outbox.filter((m) => m.subject.includes('Receipt'))).toHaveLength(1);
  });

  it('refuses a forged or mismatched signature and does not publish', async () => {
    const id = await readyExam();
    const o = await order(id);
    const c = await checkout(o.orderId);
    await ctx
      .http()
      .post('/payments/verify')
      .set(auth(trainer))
      .send({ ...c, signature: 'f'.repeat(64) })
      .expect(400);
    await ctx
      .http()
      .post('/payments/verify')
      .set(auth(trainer))
      .send({ ...c, paymentId: 'fake_pay_other' })
      .expect(400);
    const exam = await ctx.prisma.exam.findUnique({ where: { id } });
    expect(exam?.status).toBe('DRAFT');
    expect(exam?.code).toBeNull();
  });

  it("does not let another trainer settle or see someone else's order", async () => {
    const id = await readyExam();
    const o = await order(id);
    const c = await checkout(o.orderId);
    await ctx.http().post('/payments/verify').set(auth(other)).send(c).expect(404);
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(other))
      .send({ orderId: o.orderId })
      .expect(404);
    await ctx.http().post('/payments/verify').set(auth(student)).send(c).expect(404);
  });

  it('gives every exam its own code', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const id = await readyExam();
      const c = await checkout((await order(id)).orderId);
      const r = await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);
      codes.add(r.body.exam.code);
    }
    expect(codes.size).toBe(3);
  });

  it('flags a paid order whose exam was deleted', async () => {
    const id = await readyExam();
    const o = await order(id);
    await ctx.http().delete(`/exams/${id}`).set(auth(trainer)).expect(204);
    const c = await checkout(o.orderId);
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(409);
    const payment = await ctx.prisma.payment.findUnique({ where: { providerOrderId: o.orderId } });
    expect(payment?.status).toBe('CAPTURED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.orphan' } })).toBe(1);
    expect(payment?.needsRefund).toBe(true);
  });
});

describe('webhook', () => {
  it('rejects bad or missing signatures', async () => {
    await ctx.http().post('/payments/webhook').send({ event: 'payment.captured' }).expect(400);
    await ctx
      .http()
      .post('/payments/webhook')
      .set('x-razorpay-signature', 'abc')
      .set('x-razorpay-event-id', 'evt_1')
      .send({ event: 'payment.captured' })
      .expect(400);
  });

  it('publishes on payment.captured even if the browser never reports back', async () => {
    const id = await readyExam();
    const o = await order(id);
    await webhook('payment.captured', o.orderId, 'pay_1', 19900, 'evt_1').expect(200);
    const exam = await ctx.prisma.exam.findUnique({ where: { id } });
    expect(exam?.status).toBe('PUBLISHED');
    expect(exam?.code).toMatch(/^NVX-/);
    expect(ctx.mail.outbox.filter((m) => m.subject.includes('Receipt'))).toHaveLength(1);
  });

  it('ignores a redelivered event and a browser verify after the webhook', async () => {
    const id = await readyExam();
    const o = await order(id);
    await webhook('payment.captured', o.orderId, 'pay_1', 19900, 'evt_dup').expect(200);
    const again = await webhook('payment.captured', o.orderId, 'pay_1', 19900, 'evt_dup').expect(
      200,
    );
    expect(again.body.duplicate).toBe(true);
    expect(await ctx.prisma.webhookEvent.count()).toBe(1);

    const code = (await ctx.prisma.exam.findUnique({ where: { id } }))!.code;
    const c = {
      orderId: o.orderId,
      paymentId: 'pay_1',
      signature: FakePaymentProvider.sign(o.orderId, 'pay_1'),
    };
    const res = await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);
    expect(res.body.exam.code).toBe(code);
    expect(ctx.mail.outbox.filter((m) => m.subject.includes('Receipt'))).toHaveLength(1);
  });

  it('does not publish when the amount does not match', async () => {
    const id = await readyExam();
    const o = await order(id);
    await webhook('payment.captured', o.orderId, 'pay_x', 100, 'evt_amt').expect(200);
    expect((await ctx.prisma.exam.findUnique({ where: { id } }))?.status).toBe('DRAFT');
    expect(
      (await ctx.prisma.payment.findUnique({ where: { providerOrderId: o.orderId } }))?.status,
    ).toBe('CREATED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.amount.mismatch' } })).toBe(
      1,
    );
  });

  it('marks a failed payment, and never downgrades a captured one', async () => {
    const a = await readyExam();
    const oa = await order(a);
    await webhook('payment.failed', oa.orderId, 'pay_f', 19900, 'evt_f1').expect(200);
    expect(
      (await ctx.prisma.payment.findUnique({ where: { providerOrderId: oa.orderId } }))?.status,
    ).toBe('FAILED');

    const b = await readyExam();
    const ob = await order(b);
    await webhook('payment.captured', ob.orderId, 'pay_ok', 19900, 'evt_c1').expect(200);
    await webhook('payment.failed', ob.orderId, 'pay_late', 19900, 'evt_f2').expect(200);
    expect(
      (await ctx.prisma.payment.findUnique({ where: { providerOrderId: ob.orderId } }))?.status,
    ).toBe('CAPTURED');
    expect((await ctx.prisma.exam.findUnique({ where: { id: b } }))?.status).toBe('PUBLISHED');
  });

  it('answers 409 when a refunded payment is verified again', async () => {
    const id = await readyExam();
    const o = await order(id);
    const c = await checkout(o.orderId);
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(200);
    await ctx.prisma.payment.update({
      where: { providerOrderId: o.orderId },
      data: { status: 'REFUNDED' },
    });
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(c).expect(409);
    expect(
      (await ctx.prisma.payment.findUnique({ where: { providerOrderId: o.orderId } }))?.status,
    ).toBe('REFUNDED');
  });

  it('never re-captures a refunded payment on a replayed capture event', async () => {
    const id = await readyExam();
    const o = await order(id);
    await webhook('payment.captured', o.orderId, 'pay_r', 19900, 'evt_r1').expect(200);
    await ctx.prisma.payment.update({
      where: { providerOrderId: o.orderId },
      data: { status: 'REFUNDED' },
    });
    await webhook('payment.captured', o.orderId, 'pay_r', 19900, 'evt_r2').expect(200);
    expect(
      (await ctx.prisma.payment.findUnique({ where: { providerOrderId: o.orderId } }))?.status,
    ).toBe('REFUNDED');
  });

  it('can retry a failed order with a fresh one', async () => {
    const id = await readyExam();
    const first = await order(id);
    await webhook('payment.failed', first.orderId, 'pay_f', 19900, 'evt_retry').expect(200);
    const second = await order(id);
    expect(second.orderId).not.toBe(first.orderId);
  });

  it('acknowledges events it does not care about and unknown orders', async () => {
    await webhook('order.paid', 'order_none', 'pay_n', 19900, 'evt_ignored').expect(200);
    await webhook('payment.captured', 'order_unknown', 'pay_u', 19900, 'evt_unknown').expect(200);
  });
});

describe('exam codes', () => {
  it('look like NVX-XXXXXX without confusing characters', () => {
    for (let i = 0; i < 200; i++) expect(generateExamCode()).toMatch(/^NVX-[A-HJKMNP-Z2-9]{6}$/);
  });
});

describe('publish payment integrity', () => {
  async function orderWith(examId: string, studentEmails: string[]) {
    const res = await ctx
      .http()
      .post(`/exams/${examId}/publish-order`)
      .set(auth(trainer))
      .send({ studentEmails })
      .expect(200);
    return res.body as { orderId: string; amountPaise: number };
  }

  async function verify(orderId: string) {
    const paid = await checkout(orderId);
    return ctx.http().post('/payments/verify').set(auth(trainer)).send(paid);
  }

  it('gives exactly the seats that were paid for, even if another order lists more students', async () => {
    const id = await readyExam();
    const cheap = await orderWith(id, ['one@example.com']);
    // A second tab asks for 3 seats; that unpaid order must not leak into the cheap one.
    await orderWith(id, ['a@example.com', 'b@example.com', 'c@example.com']);
    await verify(cheap.orderId).then((r) => expect(r.status).toBe(200));

    const seats = await ctx.prisma.seat.findMany({ where: { pack: { examId: id } } });
    expect(seats.map((s) => s.email)).toEqual(['one@example.com']);
    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
    expect(exam.sponsoredEmails).toEqual(['one@example.com']);
  });

  it('keeps the exam row untouched until a payment is captured', async () => {
    const id = await readyExam();
    await orderWith(id, ['one@example.com', 'two@example.com']);
    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
    expect(exam.sponsoredEmails).toEqual([]);
  });

  it('flags a second creation payment for an already published exam for refund', async () => {
    const id = await readyExam();
    const first = await orderWith(id, []);
    // A different seat list makes a different order, so both can be open at the same time.
    const second = await orderWith(id, ['dup@example.com']);
    const firstPaid = await checkout(first.orderId);
    const secondPaid = await checkout(second.orderId);
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(firstPaid).expect(200);
    await ctx.http().post('/payments/verify').set(auth(trainer)).send(secondPaid).expect(200);

    const payments = await ctx.prisma.payment.findMany({
      where: { examId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.map((p) => p.needsRefund)).toEqual([false, true]);
    // The duplicate buys no seats and no receipt.
    expect(await ctx.prisma.seat.count({ where: { pack: { examId: id } } })).toBe(0);
    const receipts = ctx.mail.outbox.filter(
      (m) => m.to === 'trainer@example.com' && /^Receipt /.test(m.subject),
    );
    expect(receipts).toHaveLength(1);
  });

  it('does not publish when the payment lands after the exam window closed', async () => {
    const id = await readyExam();
    const o = await order(id);
    await ctx.prisma.exam.update({
      where: { id },
      data: {
        startsAt: new Date(Date.now() - 3 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    await verify(o.orderId).then((r) => expect(r.status).toBe(200));

    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
    expect(exam.status).toBe('DRAFT');
    expect(exam.code).toBeNull();
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { examId: id } });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.needsRefund).toBe(true);
    expect(ctx.mail.lastTo('trainer@example.com')?.subject).toMatch(/was not published/);
  });
});
