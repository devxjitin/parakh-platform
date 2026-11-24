import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';
import { PAYMENT_PROVIDER, GatewayRefundError, PaymentProvider } from './provider';
import { ReconciliationService, istDayRange, previousIstDay } from './reconciliation.service';
import { REFUND_STALE_MS, RefundSweeperService } from './refund-sweeper.service';

type Token = { accessToken: string };

let ctx: TestContext;
let provider: PaymentProvider;
let sweeper: RefundSweeperService;
let reconciliation: ReconciliationService;
let trainer: Token;
let admin: Token;
let exam: PublishedExam;

beforeAll(async () => {
  ctx = await createTestApp();
  provider = ctx.app.get<PaymentProvider>(PAYMENT_PROVIDER);
  sweeper = ctx.app.get(RefundSweeperService);
  reconciliation = ctx.app.get(ReconciliationService);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  admin = await createAdmin(ctx);
  exam = await publishExam(ctx, trainer);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const refund = (paymentId: string) =>
  ctx
    .http()
    .post(`/admin/finance/payments/${paymentId}/refund`)
    .set(auth(admin))
    .send({ reason: 'Student asked' });

async function joined() {
  const sam = await newStudent(ctx, 'sam@example.com');
  await joinExam(ctx, sam, exam.code);
  const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { purpose: 'EXAM_JOIN' } });
  return { sam, payment };
}

const reversalRows = (paymentId: string) =>
  ctx.prisma.ledgerEntry.count({ where: { paymentId, type: 'REFUND' } });

describe('refund that cannot finish at once (PENDING_REFUND)', () => {
  it('stays PENDING_REFUND when the gateway outcome is unknown, and the sweeper finishes it', async () => {
    const { payment } = await joined();
    vi.spyOn(provider, 'refund').mockRejectedValueOnce(new GatewayRefundError('timeout', false));

    await refund(payment.id).expect(503);
    const pending = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(pending.status).toBe('PENDING_REFUND');
    // Nothing is cancelled or reversed until the money is confirmed back.
    expect(await ctx.prisma.enrollment.count({ where: { examId: exam.examId } })).toBe(1);
    expect(await reversalRows(payment.id)).toBe(0);
    // A second click is refused instead of refunding twice.
    await refund(payment.id).expect(409);

    const later = new Date(Date.now() + REFUND_STALE_MS + 1_000);
    expect(await sweeper.sweep(later)).toBe(1);
    const done = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(done.status).toBe('REFUNDED');
    expect(done.refundId).toMatch(/^fake_refund_/);
    expect(await ctx.prisma.enrollment.count({ where: { examId: exam.examId } })).toBe(0);
    expect(await reversalRows(payment.id)).toBeGreaterThan(0);
    expect(ctx.mail.lastTo('sam@example.com')?.subject).toMatch(/Refund of INR/);
    // Running it again changes nothing.
    expect(await sweeper.sweep(later)).toBe(0);
  });

  it('uses a refund the gateway already holds instead of refunding twice', async () => {
    const { payment } = await joined();
    const refundCall = vi
      .spyOn(provider, 'refund')
      .mockRejectedValueOnce(new GatewayRefundError('timeout', false));
    await refund(payment.id).expect(503);

    vi.spyOn(provider, 'findRefund').mockResolvedValue({ refundId: 'rfnd_already_there' });
    await sweeper.sweep(new Date(Date.now() + REFUND_STALE_MS + 1_000));

    expect(refundCall).toHaveBeenCalledTimes(1); // only the first, failed attempt
    const done = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(done).toMatchObject({ status: 'REFUNDED', refundId: 'rfnd_already_there' });
  });

  it('does not touch a refund that was only just claimed', async () => {
    const { payment } = await joined();
    vi.spyOn(provider, 'refund').mockRejectedValueOnce(new GatewayRefundError('timeout', false));
    await refund(payment.id).expect(503);
    expect(await sweeper.sweep(new Date())).toBe(0);
    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('PENDING_REFUND');
  });

  it('goes back to CAPTURED when the gateway clearly rejects the refund', async () => {
    const { payment } = await joined();
    vi.spyOn(provider, 'refund').mockRejectedValueOnce(new GatewayRefundError('bad request', true));
    await refund(payment.id).expect(503);
    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe('CAPTURED');
    expect(row.refundedAt).toBeNull();
    // The admin can simply try again.
    await refund(payment.id).expect(200);
  });

  it('shows a pending refund to the student as in progress', async () => {
    const { sam, payment } = await joined();
    vi.spyOn(provider, 'refund').mockRejectedValueOnce(new GatewayRefundError('timeout', false));
    await refund(payment.id).expect(503);
    const mine = (await ctx.http().get('/me/payments').set(auth(sam)).expect(200)).body[0];
    expect(mine).toMatchObject({ status: 'PENDING_REFUND', canRequestRefund: false });
  });
});

describe('daily reconciliation', () => {
  const today = previousIstDay(new Date(Date.now() + 24 * 3_600_000));

  const gatewayRow = (p: {
    providerPaymentId: string | null;
    providerOrderId: string;
    amountPaise: number;
  }) => ({
    paymentId: p.providerPaymentId!,
    orderId: p.providerOrderId,
    amountPaise: p.amountPaise,
    status: 'captured',
    amountRefundedPaise: 0,
  });

  it('is skipped for the fake provider', async () => {
    const report = await reconciliation.reconcile(today);
    expect(report.skipped).toMatch(/fake/i);
    expect(report.mismatches).toEqual([]);
  });

  it('reports zero mismatches when Razorpay and the database agree', async () => {
    const { payment } = await joined();
    const publishing = await ctx.prisma.payment.findFirstOrThrow({
      where: { purpose: 'EXAM_CREATION' },
    });
    vi.spyOn(provider, 'listPayments').mockResolvedValue([
      gatewayRow(payment),
      gatewayRow(publishing),
    ]);
    const report = await reconciliation.reconcile(today);
    expect(report).toMatchObject({ gatewayCount: 2, databaseCount: 2, matched: 2, mismatches: [] });
  });

  it('lists each kind of difference', async () => {
    const { payment } = await joined();
    const publishing = await ctx.prisma.payment.findFirstOrThrow({
      where: { purpose: 'EXAM_CREATION' },
    });
    vi.spyOn(provider, 'listPayments').mockResolvedValue([
      { ...gatewayRow(payment), amountPaise: payment.amountPaise + 100 }, // amount differs
      {
        paymentId: 'pay_unknown',
        orderId: 'order_unknown',
        amountPaise: 5_000,
        status: 'captured',
        amountRefundedPaise: 0,
      }, // paid at the gateway, not in our database
      // `publishing` is missing at the gateway entirely
    ]);
    const report = await reconciliation.reconcile(today);
    const kinds = report.mismatches.map((m) => m.kind).sort();
    expect(kinds).toEqual([
      'AMOUNT_DIFFERS',
      'CAPTURED_AT_GATEWAY_NOT_IN_DB',
      'CAPTURED_IN_DB_NOT_AT_GATEWAY',
    ]);
    expect(report.mismatches.find((m) => m.kind === 'CAPTURED_IN_DB_NOT_AT_GATEWAY')).toMatchObject(
      {
        providerPaymentId: publishing.providerPaymentId,
      },
    );
  });

  it('flags a refund that the gateway shows but the database does not, and a stuck refund', async () => {
    const { payment } = await joined();
    vi.spyOn(provider, 'listPayments').mockResolvedValue([
      { ...gatewayRow(payment), status: 'refunded', amountRefundedPaise: payment.amountPaise },
    ]);
    let report = await reconciliation.reconcile(today);
    expect(report.mismatches.map((m) => m.kind)).toContain('REFUNDED_AT_GATEWAY_NOT_IN_DB');

    await ctx.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PENDING_REFUND', refundedAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    vi.spyOn(provider, 'listPayments').mockResolvedValue([
      { ...gatewayRow(payment), status: 'refunded', amountRefundedPaise: payment.amountPaise },
    ]);
    report = await reconciliation.reconcile(today);
    expect(report.mismatches.map((m) => m.kind)).toContain('STUCK_PENDING_REFUND');
  });

  it('rejects a bad day', async () => {
    await expect(reconciliation.reconcile('22-11-2026')).rejects.toThrow(RangeError);
    await ctx
      .http()
      .post('/admin/finance/reconcile')
      .set(auth(admin))
      .send({ day: 'x' })
      .expect(400);
  });

  it('is available to admins only', async () => {
    await ctx.http().post('/admin/finance/reconcile').set(auth(trainer)).send({}).expect(403);
    const res = await ctx
      .http()
      .post('/admin/finance/reconcile')
      .set(auth(admin))
      .send({})
      .expect(200);
    expect(res.body).toMatchObject({ mismatches: [] });
  });

  it('runs once a day, from 03:00 IST, and emails admins only when something differs', async () => {
    await joined();
    vi.spyOn(provider, 'listPayments').mockResolvedValue([]); // gateway has nothing: mismatches
    const nextDay = istDayRange(today).to.getTime();
    const tooEarly = new Date(nextDay + 2 * 3_600_000);
    const due = new Date(nextDay + 10 * 3_600_000);

    expect(await reconciliation.runDaily(tooEarly)).toBeNull();
    ctx.mail.clear();
    const report = await reconciliation.runDaily(due);
    expect(report?.mismatches.length).toBeGreaterThan(0);
    expect(ctx.mail.lastTo('admin@example.com')?.subject).toMatch(/Payment reconciliation/);
    const logged = await ctx.prisma.auditLog.findFirst({
      where: { action: 'payment.reconciliation', entityId: today },
    });
    expect(logged).not.toBeNull();

    // The same day is never run twice.
    expect(await reconciliation.runDaily(due)).toBeNull();
  });
});
