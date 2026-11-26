import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { LedgerService } from '../ledger/ledger.service';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

type Token = { accessToken: string };

let ctx: TestContext;
let trainer: Token;
let admin: Token;
let exam: PublishedExam;
let trainerId: string;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  admin = await createAdmin(ctx);
  trainerId = (await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'trainer@example.com' } }))
    .id;
  exam = await publishExam(ctx, trainer);
});

const get = (who: Token, url: string) => ctx.http().get(url).set(auth(who));
const post = (who: Token, url: string, body: object = {}) =>
  ctx.http().post(url).set(auth(who)).send(body);
const earnings = async () => ({
  balances: await ctx.app.get(LedgerService).balances(trainerId),
});
/** The company records where it pays the trainer (trainers no longer enter this themselves). */
const setDetails = () =>
  ctx.prisma.examinerProfile.upsert({
    where: { userId: trainerId },
    create: {
      userId: trainerId,
      payoutMethod: 'UPI',
      upiId: 'trainer@okbank',
      payoutDetailsVerifiedAt: new Date(),
    },
    update: { payoutMethod: 'UPI', upiId: 'trainer@okbank', payoutDetailsVerifiedAt: new Date() },
  });
/** Pays everything that is payable, the way the company does it now. */
const payAllRaw = (utr: string) =>
  post(admin, '/admin/finance/payouts', { examinerId: trainerId, amountPaise: 52_150, utr });
const payAll = async (utr = 'UTR123456') => {
  const { payablePaise } = (await earnings()).balances;
  return (
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: payablePaise,
      utr,
    }).expect(200)
  ).body;
};
const ledger = async () => (await get(admin, '/admin/finance/ledger').expect(200)).body;

/** n students pay the join fee. Returns their tokens. */
async function students(n: number, prefix = 'stu') {
  const out: Token[] = [];
  for (let i = 0; i < n; i++) {
    const s = await newStudent(ctx, `${prefix}${i}@example.com`);
    await joinExam(ctx, s, exam.code);
    out.push(s);
  }
  return out;
}

/** The exam's results are published: the trainer's share becomes payable. */
const publishResults = () =>
  ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });

describe('ledger', () => {
  it('books the creation fee and splits each join fee 50/50, always balancing to zero', async () => {
    let l = await ledger();
    expect(l.platformPaise).toBe(19_900);
    expect(l.grossCollectedPaise).toBe(19_900);
    expect(l.totalPaise).toBe(0);

    await students(1);
    l = await ledger();
    expect(l.grossCollectedPaise).toBe(19_900 + 14_900);
    expect(l.platformPaise).toBe(19_900 + 7_450);
    expect(l.owedToTrainersPaise).toBe(7_450);
    expect(l.totalPaise).toBe(0);
    expect(l.unbalancedTransactions).toEqual([]);

    const e = await earnings();
    expect(e.balances.accruedPaise).toBe(7_450);
    expect(e.balances.payablePaise).toBe(0);
  });

  it('is only for admins', async () => {
    await get(trainer, '/admin/finance/ledger').expect(403);
    await ctx.http().get('/admin/finance/ledger').expect(401);
  });

  it('turns accrued into payable when the exam results are published', async () => {
    await students(2);
    await publishResults();
    const e = await earnings();
    expect(e.balances.accruedPaise).toBe(0);
    expect(e.balances.payablePaise).toBe(14_900);
  });

  it('never accepts an unbalanced entry', async () => {
    const { LedgerService } = await import('../ledger/ledger.service');
    const svc = ctx.app.get(LedgerService);
    await expect(
      svc.post(
        ctx.prisma,
        [
          { account: 'EXTERNAL', amountPaise: -100 },
          { account: 'PLATFORM', amountPaise: 99 },
        ],
        { type: 'CREDIT' },
      ),
    ).rejects.toThrow(/out of balance/);
  });
});

describe('payouts', () => {
  async function readyToPay(count = 7) {
    await students(count);
    await publishResults();
    await setDetails();
  }

  it('trainers have no earnings or payout routes any more', async () => {
    await get(trainer, '/earnings').expect(404);
    await ctx.http().put('/earnings/payout-details').set(auth(trainer)).send({}).expect(404);
    await post(trainer, '/payouts/request').expect(404);
  });

  it('is paid by the company with a UTR, books the ledger and emails the trainer', async () => {
    await readyToPay(7); // 7 x 74.50 = 521.50
    const rows = (await get(admin, '/admin/finance/payable').expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0].balances.payablePaise).toBe(52_150);
    expect(rows[0].destination).toBe('trainer@okbank');

    await post(trainer, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 52_150,
      utr: 'UTR123456',
    }).expect(403);
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 52_150,
      utr: '12',
    }).expect(400);
    ctx.mail.clear();
    const paid = await payAll();
    expect(paid.status).toBe('PAID');
    expect(paid.utr).toBe('UTR123456');
    expect(paid.amountPaise).toBe(52_150);

    const e = await earnings();
    expect(e.balances.paidPaise).toBe(52_150);
    expect(e.balances.payablePaise).toBe(0);
    const l = await ledger();
    expect(l.paidOutPaise).toBe(52_150);
    expect(l.owedToTrainersPaise).toBe(0);
    expect(l.totalPaise).toBe(0);

    const mail = ctx.mail.lastTo('trainer@example.com');
    expect(mail?.subject).toContain('521.50');
    expect(mail?.text).toContain('UTR123456');

    const csv = (await get(admin, `/payouts/${paid.id}/statement.csv`).expect(200)).text;
    expect(csv).toContain('UTR123456');
    expect(csv).toContain('521.50');
    expect(csv).toContain('Student fee share');
    // A trainer may download their own statement (other trainers get 404: see earnings tests).
    const own = (await get(trainer, `/payouts/${paid.id}/statement.csv`).expect(200)).text;
    expect(own).toContain('UTR123456');
  });

  it('never pays more than is payable', async () => {
    await readyToPay();
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 60_000,
      utr: 'UTR777777',
    }).expect(409);
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 2_000,
      utr: 'UTR777777',
    }).expect(200);
    expect((await earnings()).balances.payablePaise).toBe(50_150);
    await payAll('UTR999999');
    expect((await ledger()).totalPaise).toBe(0);
    expect((await earnings()).balances.paidPaise).toBe(52_150);
  });

  it('cannot pay money that is not payable yet', async () => {
    await students(7);
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 10_000,
      utr: 'UTR555555',
    }).expect(409); // exam results are not published
  });

  it('refuses to pay when the payout details are missing or not verified', async () => {
    await students(7);
    await publishResults();
    // No details at all.
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 10_000,
      utr: 'UTR424242',
    }).expect(409);
    // Details saved but changed after the last check: verification is reset.
    await setDetails();
    await ctx.prisma.examinerProfile.update({
      where: { userId: trainerId },
      data: { payoutDetailsVerifiedAt: null },
    });
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 10_000,
      utr: 'UTR424242',
    }).expect(409);
    expect(await ctx.prisma.payout.count()).toBe(0);
    // Once an admin verifies them, the same payment goes through.
    await post(admin, `/admin/finance/examiners/${trainerId}/verify-details`).expect(200);
    await post(admin, '/admin/finance/payouts', {
      examinerId: trainerId,
      amountPaise: 10_000,
      utr: 'UTR424242',
    }).expect(200);
  });

  it('two simultaneous payouts of the same money pay it once', async () => {
    await readyToPay();
    const results = await Promise.all([payAllRaw('UTR111111'), payAllRaw('UTR222222')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await ledger()).paidOutPaise).toBe(52_150);
  });
});

describe('trainer share is fixed when the order is made', () => {
  it('keeps the percent that applied at order time, even if an admin changes it before payment', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const order = (await ctx.http().post(`/join/${exam.code}/order`).set(auth(sam)).expect(200))
      .body;
    const settings = (await get(admin, '/admin/settings').expect(200)).body;
    await ctx
      .http()
      .put('/admin/settings')
      .set(auth(admin))
      .send({ ...settings, examinerSharePercent: 20 })
      .expect(200);
    const paid = (
      await post(sam, '/payments/fake/complete', { orderId: order.orderId }).expect(200)
    ).body;
    await post(sam, '/payments/verify', paid).expect(200);

    // 50% of 149.00 (the percent at order time), not 20%
    expect((await earnings()).balances.accruedPaise).toBe(7_450);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { purpose: 'EXAM_JOIN' } });
    expect(payment.examinerSharePercent).toBe(50);
  });
});

describe('refunds', () => {
  async function joinPayment(email: string) {
    const s = await newStudent(ctx, email);
    await joinExam(ctx, s, exam.code);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { userId: u.id, purpose: 'EXAM_JOIN' },
    });
    return { student: s, payment };
  }
  const refund = (id: string, reason = 'Student asked') =>
    post(admin, `/admin/finance/payments/${id}/refund`, { reason });

  it('returns the money, cancels the seat and takes back the trainer share', async () => {
    const a = await joinPayment('a@example.com');
    await joinPayment('b@example.com');
    expect((await earnings()).balances.accruedPaise).toBe(14_900);

    ctx.mail.clear();
    await post(trainer, `/admin/finance/payments/${a.payment.id}/refund`, { reason: 'x' }).expect(
      403,
    );
    await refund(a.payment.id, 'x').expect(400);
    await refund(a.payment.id).expect(200);
    await refund(a.payment.id).expect(409); // only once

    const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: a.payment.id } });
    expect(p.status).toBe('REFUNDED');
    expect(p.refundId).toMatch(/^fake_refund_/);
    expect(await ctx.prisma.enrollment.count({ where: { paymentId: a.payment.id } })).toBe(0);
    expect(ctx.mail.lastTo('a@example.com')?.subject).toContain('149.00');

    const e = await earnings();
    expect(e.balances.accruedPaise).toBe(7_450);
    expect(await ctx.prisma.enrollment.count({ where: { examId: exam.examId } })).toBe(1);
    const l = await ledger();
    expect(l.totalPaise).toBe(0);
    expect(l.unbalancedTransactions).toEqual([]);
    expect(l.owedToTrainersPaise).toBe(7_450);

    // the seat is free again: the student can join once more
    const again = await newStudent(ctx, 'a2@example.com');
    await joinExam(ctx, again, exam.code);
  });

  it('cannot start an attempt on a seat whose refund is in progress, and the claim rolls back if one already started', async () => {
    const a = await joinPayment('a@example.com');
    const enrollment = await ctx.prisma.enrollment.findFirstOrThrow({
      where: { paymentId: a.payment.id },
    });
    // The refund was claimed (gateway call pending): the student can no longer begin.
    await ctx.prisma.payment.update({
      where: { id: a.payment.id },
      data: { status: 'PENDING_REFUND' },
    });
    await ctx
      .http()
      .post('/attempts')
      .set(auth(a.student))
      .send({ enrollmentId: enrollment.id })
      .expect(409);
    expect(await ctx.prisma.attempt.count({ where: { enrollmentId: enrollment.id } })).toBe(0);

    // A student who started in the meantime blocks the claim itself: payment stays CAPTURED.
    const b = await joinPayment('b@example.com');
    const enrollmentB = await ctx.prisma.enrollment.findFirstOrThrow({
      where: { paymentId: b.payment.id },
    });
    await ctx
      .http()
      .post('/attempts')
      .set(auth(b.student))
      .send({ enrollmentId: enrollmentB.id })
      .expect(200);
    await refund(b.payment.id).expect(409);
    const after = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: b.payment.id } });
    expect(after.status).toBe('CAPTURED');
  });

  it('refuses when the student already started the exam, or for creation fees', async () => {
    const a = await joinPayment('a@example.com');
    const enrollment = await ctx.prisma.enrollment.findFirstOrThrow({
      where: { paymentId: a.payment.id },
    });
    await ctx
      .http()
      .post('/attempts')
      .set(auth(a.student))
      .send({ enrollmentId: enrollment.id })
      .expect(200);
    await refund(a.payment.id).expect(409);

    const creation = await ctx.prisma.payment.findFirstOrThrow({
      where: { purpose: 'EXAM_CREATION' },
    });
    await refund(creation.id).expect(409);
    await refund('00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('after payout, a refund shows as owed back', async () => {
    const first = await joinPayment('s0@example.com');
    for (let i = 1; i < 7; i++) await joinPayment(`s${i}@example.com`);
    await publishResults();
    await setDetails();
    await payAll();

    await refund(first.payment.id).expect(200);
    let b = (await earnings()).balances;
    expect(b.owedBackPaise).toBe(7_450);
    expect(b.payablePaise).toBe(0);
    expect((await ledger()).totalPaise).toBe(0);
  });

  it('lists payments for the admin and can filter them', async () => {
    await joinPayment('a@example.com');
    const all = (await get(admin, '/admin/finance/payments').expect(200)).body;
    expect(all.length).toBeGreaterThanOrEqual(2);
    const joins = (await get(admin, '/admin/finance/payments?purpose=EXAM_JOIN&q=sam').expect(200))
      .body;
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({
      purpose: 'EXAM_JOIN',
      status: 'CAPTURED',
      amountPaise: 14_900,
    });
    await get(trainer, '/admin/finance/payments').expect(403);
  });
});
