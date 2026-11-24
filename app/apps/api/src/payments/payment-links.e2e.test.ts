import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { ENV, type Env } from '../config/env';
import { FakePaymentProvider } from './provider';

// PAYMENT_FLOW=link: payers go to a hosted Razorpay Payment Link page instead of in-page Checkout.
let ctx: TestContext;
let env: Env;
let trainer: { accessToken: string };
let other: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
  env = ctx.app.get<Env>(ENV);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  env.PAYMENT_FLOW = 'link';
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
});
afterEach(() => {
  env.PAYMENT_FLOW = 'checkout';
});

const auth = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function readyExam() {
  const res = await ctx
    .http()
    .post('/exams')
    .set(auth(trainer))
    .send({ title: 'Cloud Fundamentals', durationMinutes: 60, startsAt: days(1), endsAt: days(2) })
    .expect(201);
  await ctx
    .http()
    .post(`/exams/${res.body.id}/questions`)
    .set(auth(trainer))
    .send({ type: 'SINGLE', body: 'What is IaaS?', options: ['A', 'B'], correctOptions: [0] })
    .expect(201);
  return res.body.id as string;
}

async function linkOrder(examId: string) {
  const res = await ctx
    .http()
    .post(`/exams/${examId}/publish-order`)
    .set(auth(trainer))
    .expect(200);
  return res.body as { orderId: string; paymentUrl?: string; amountPaise: number };
}

/** What Razorpay puts on the callback URL after a paid link. */
function callback(linkId: string, paymentId = 'pay_link_1', status = 'paid') {
  const base = { linkId, referenceId: 'ref_1', status, paymentId };
  return { ...base, signature: FakePaymentProvider.signLink(base) };
}

describe('payment links', () => {
  it('hands out a hosted payment page and reuses it while unpaid', async () => {
    const id = await readyExam();
    const first = await linkOrder(id);
    expect(first.orderId).toMatch(/^plink_/);
    expect(first.paymentUrl).toMatch(/^https:\/\//);
    const again = await linkOrder(id);
    expect(again.orderId).toBe(first.orderId);
    expect(again.paymentUrl).toBe(first.paymentUrl);
    expect(await ctx.prisma.payment.count()).toBe(1);
  });

  it('publishes the exam when the payer comes back with a valid signature', async () => {
    const id = await readyExam();
    const { orderId } = await linkOrder(id);
    const res = await ctx
      .http()
      .post('/payments/verify-link')
      .set(auth(trainer))
      .send(callback(orderId))
      .expect(200);
    expect(res.body.exam.status).toBe('PUBLISHED');
    expect(res.body.exam.code).toMatch(/^NVX-/);
    expect(res.body.next).toBe(`/exams/edit/?id=${id}`);
    const payment = await ctx.prisma.payment.findUniqueOrThrow({
      where: { providerOrderId: orderId },
    });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerPaymentId).toBe('pay_link_1');
  });

  it('rejects a forged or unpaid callback, and other users', async () => {
    const id = await readyExam();
    const { orderId } = await linkOrder(id);
    await ctx
      .http()
      .post('/payments/verify-link')
      .set(auth(trainer))
      .send({ ...callback(orderId), signature: 'f'.repeat(64) })
      .expect(400);
    await ctx
      .http()
      .post('/payments/verify-link')
      .set(auth(trainer))
      .send(callback(orderId, 'pay_link_1', 'cancelled'))
      .expect(400);
    await ctx
      .http()
      .post('/payments/verify-link')
      .set(auth(other))
      .send(callback(orderId))
      .expect(404);
    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
    expect(exam.status).toBe('DRAFT');
  });

  it('publishes from the payment_link.paid webhook, once', async () => {
    const id = await readyExam();
    const { orderId, amountPaise } = await linkOrder(id);
    const body = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: orderId, status: 'paid' } },
        payment: {
          entity: { id: 'pay_link_2', order_id: 'order_made_by_link', amount: amountPaise },
        },
      },
    });
    await ctx
      .http()
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', 'evt_link_1')
      .set('x-razorpay-signature', FakePaymentProvider.signWebhook(body))
      .send(body)
      .expect(200);
    const exam = await ctx.prisma.exam.findUniqueOrThrow({ where: { id } });
    expect(exam.status).toBe('PUBLISHED');
    // The payer coming back afterwards just gets the same result.
    const res = await ctx
      .http()
      .post('/payments/verify-link')
      .set(auth(trainer))
      .send(callback(orderId, 'pay_link_2'))
      .expect(200);
    expect(res.body.exam.code).toBe(exam.code);
    expect(await ctx.prisma.payment.count({ where: { status: 'CAPTURED' } })).toBe(1);
  });

  it('switching back to Checkout makes a normal order', async () => {
    const id = await readyExam();
    await linkOrder(id);
    env.PAYMENT_FLOW = 'checkout';
    const res = await linkOrder(id);
    expect(res.orderId).toMatch(/^fake_order_/);
    expect(res.paymentUrl).toBeUndefined();
  });
});
