import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
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
const put = (who: Token, url: string, body: object = {}) =>
  ctx.http().put(url).set(auth(who)).send(body);

/** n students pay the join fee (the trainer's share is 50% of each). */
async function students(n: number) {
  for (let i = 0; i < n; i++) {
    const s = await newStudent(ctx, `stu${i}@example.com`);
    await joinExam(ctx, s, exam.code);
  }
}
const publishResults = () =>
  ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });

describe('trainer earnings', () => {
  it('shows the same numbers as the admin payout screen, plus per-exam totals', async () => {
    await students(2);
    let mine = (await get(trainer, '/me/earnings').expect(200)).body;
    expect(mine.balances).toMatchObject({ accruedPaise: 14_900, payablePaise: 0, paidPaise: 0 });
    expect(mine.exams).toEqual([
      expect.objectContaining({
        examId: exam.examId,
        joins: 2,
        grossPaise: 29_800,
        sharePaise: 14_900,
        state: 'ACCRUED',
      }),
    ]);
    expect(mine.details.method).toBeNull();

    await publishResults();
    mine = (await get(trainer, '/me/earnings').expect(200)).body;
    expect(mine.exams[0].state).toBe('PAYABLE');
    expect(mine.balances.payablePaise).toBe(14_900);

    // One function feeds both screens, so the two can never disagree.
    const rows = (await get(admin, '/admin/finance/payable').expect(200)).body;
    const row = rows.find((r: { examinerId: string }) => r.examinerId === trainerId);
    expect(row.balances).toEqual(mine.balances);
  });

  it('is for trainers only', async () => {
    const student = await newStudent(ctx, 'sam@example.com');
    await get(student, '/me/earnings').expect(403);
    await get(admin, '/me/earnings').expect(403);
    await ctx.http().get('/me/earnings').expect(401);
  });
});

describe('payout details', () => {
  it('saves UPI, masks a bank account, encrypts it, and needs re-verifying after every change', async () => {
    await put(trainer, '/me/payout-details', { method: 'UPI', upiId: 'not a upi' }).expect(400);
    await put(trainer, '/me/payout-details', {
      method: 'BANK',
      accountName: 'Tara Trainer',
      accountNumber: '12AB',
      ifsc: 'HDFC0001234',
    }).expect(400);

    const upi = (
      await put(trainer, '/me/payout-details', { method: 'UPI', upiId: 'tara@okbank' }).expect(200)
    ).body;
    expect(upi).toMatchObject({ method: 'UPI', upiId: 'tara@okbank', verifiedAt: null });

    const bank = (
      await put(trainer, '/me/payout-details', {
        method: 'BANK',
        accountName: 'Tara Trainer',
        accountNumber: '123456789012',
        ifsc: 'hdfc0001234',
      }).expect(200)
    ).body;
    expect(bank).toMatchObject({
      method: 'BANK',
      accountName: 'Tara Trainer',
      accountMasked: '****9012',
      ifsc: 'HDFC0001234',
      upiId: null,
    });
    // The full number is never returned, and never stored in the clear.
    expect(JSON.stringify(bank)).not.toContain('123456789012');
    const stored = await ctx.prisma.examinerProfile.findUniqueOrThrow({
      where: { userId: trainerId },
    });
    expect(stored.bankAccountNoEnc).toBeTruthy();
    expect(stored.bankAccountNoEnc).not.toContain('123456789012');
    expect(stored.upiId).toBeNull();
    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: 'payout.details.update' },
    });
    expect(JSON.stringify(audit)).not.toContain('123456789012');

    // NandiVex verifies; any later change clears it again.
    await post(admin, `/admin/finance/examiners/${trainerId}/verify-details`).expect(200);
    expect((await get(trainer, '/me/earnings').expect(200)).body.details.verifiedAt).toBeTruthy();
    await put(trainer, '/me/payout-details', { method: 'UPI', upiId: 'tara@okbank' }).expect(200);
    const after = (await get(trainer, '/me/earnings').expect(200)).body.details;
    expect(after).toMatchObject({
      method: 'UPI',
      verifiedAt: null,
      accountMasked: null,
      ifsc: null,
    });
  });

  it('lets the admin see the full account number when paying, and nobody else', async () => {
    await students(7);
    await publishResults();
    await put(trainer, '/me/payout-details', {
      method: 'BANK',
      accountName: 'Tara Trainer',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
    }).expect(200);
    const rows = (await get(admin, '/admin/finance/payable').expect(200)).body;
    expect(rows[0].destination).toContain('123456789012');
    await get(trainer, '/admin/finance/payable').expect(403);
  });
});

describe('payout requests', () => {
  it('needs details and enough payable money, allows one open request, and shows it as paid later', async () => {
    await post(trainer, '/me/payouts/request').expect(409); // no details yet
    await put(trainer, '/me/payout-details', { method: 'UPI', upiId: 'tara@okbank' }).expect(200);
    await post(trainer, '/me/payouts/request').expect(409); // nothing payable

    await students(7);
    await post(trainer, '/me/payouts/request').expect(409); // results not published yet
    await publishResults();

    const req = (await post(trainer, '/me/payouts/request').expect(200)).body;
    expect(req).toMatchObject({ status: 'REQUESTED', amountPaise: 52_150, method: 'UPI' });
    await post(trainer, '/me/payouts/request').expect(409); // one at a time

    let mine = (await get(trainer, '/me/earnings').expect(200)).body;
    expect(mine.balances).toMatchObject({ pendingPaise: 52_150, payablePaise: 0 });
    expect(mine.payouts[0]).toMatchObject({ id: req.id, status: 'REQUESTED' });

    const rows = (await get(admin, '/admin/finance/payable').expect(200)).body;
    expect(rows[0].request.id).toBe(req.id);
    await post(admin, `/admin/finance/payouts/${req.id}/pay`, { utr: 'UTR987654' }).expect(200);

    mine = (await get(trainer, '/me/earnings').expect(200)).body;
    expect(mine.balances).toMatchObject({ paidPaise: 52_150, pendingPaise: 0, payablePaise: 0 });
    expect(mine.payouts[0]).toMatchObject({ status: 'PAID', utr: 'UTR987654' });

    // The trainer can download their own statement, but not someone else's.
    const csv = await get(trainer, `/payouts/${req.id}/statement.csv`).expect(200);
    expect(csv.text).toContain('UTR987654');
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await get(other, `/payouts/${req.id}/statement.csv`).expect(404);
  });
});
