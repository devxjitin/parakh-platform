import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';
import { monthOf, monthRange } from './admin-reports.service';

type Token = { accessToken: string };

let ctx: TestContext;
let trainer: Token;
let admin: Token;
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
  admin = await createAdmin(ctx);
  exam = await publishExam(ctx, trainer);
});

const get = (who: Token, url: string) => ctx.http().get(url).set(auth(who));
const put = (who: Token, url: string, body: object) =>
  ctx.http().put(url).set(auth(who)).send(body);
const month = () => monthOf(new Date());
const window = () => ({
  durationMinutes: 30,
  startsAt: new Date(Date.now() - 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
});

async function students(n: number) {
  const out: Token[] = [];
  for (let i = 0; i < n; i++) {
    const s = await newStudent(ctx, `stu${i}@example.com`);
    await joinExam(ctx, s, exam.code);
    out.push(s);
  }
  return out;
}

describe('access', () => {
  it('is for admins only', async () => {
    for (const url of [
      '/admin/overview',
      `/admin/reports/monthly?month=${month()}`,
      '/admin/reports/series',
      '/admin/exams',
      '/admin/audit',
      '/admin/settings',
    ]) {
      await get(trainer, url).expect(403);
      await ctx.http().get(url).expect(401);
    }
    await ctx
      .http()
      .put('/admin/settings')
      .set(auth(trainer))
      .send({ examCreationPaise: 1, examJoinPaise: 1, examinerSharePercent: 1, minPayoutPaise: 1 })
      .expect(403);
  });
});

describe('monthly report: how much did we earn and owe', () => {
  it('adds up money in, NandiVex revenue and what trainers are owed', async () => {
    await students(3); // 3 x 149.00
    const r = (await get(admin, `/admin/reports/monthly?month=${month()}`).expect(200)).body;
    expect(r.grossPaise).toBe(19_900 + 3 * 14_900);
    expect(r.platformRevenuePaise).toBe(19_900 + 3 * 7_450);
    expect(r.examinerEarnedPaise).toBe(3 * 7_450);
    expect(r.owedAtMonthEndPaise).toBe(3 * 7_450);
    expect(r.refundedPaise).toBe(0);
    expect(r.paidOutPaise).toBe(0);
    // results are not published yet, so nothing can be paid out
    expect(r.payableNowPaise).toBe(0);
    expect(r.examiners).toHaveLength(1);
    expect(r.examiners[0]).toMatchObject({
      name: expect.any(String),
      earnedPaise: 22_350,
      owedAtMonthEndPaise: 22_350,
    });
    // money in = platform + what trainers earned
    expect(r.platformRevenuePaise + r.examinerEarnedPaise).toBe(r.grossPaise);
  });

  it('shows refunds, payouts and what is payable now', async () => {
    await students(4);
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });

    // refund one student's payment
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { examId: exam.examId, purpose: 'EXAM_JOIN' },
    });
    await ctx
      .http()
      .post(`/admin/finance/payments/${payment.id}/refund`)
      .set(auth(admin))
      .send({ reason: 'Student asked' })
      .expect(200);

    // the trainer asks for a payout and NandiVex pays it
    // 3 students x 74.50 = 223.50, below the 500 minimum, so an admin pays a direct payout
    const trainerRow = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'trainer@example.com' },
    });
    const before = (await get(admin, `/admin/reports/monthly?month=${month()}`).expect(200)).body;
    expect(before.refundedPaise).toBe(14_900);
    expect(before.examinerEarnedPaise).toBe(3 * 7_450);
    expect(before.payableNowPaise).toBe(3 * 7_450);
    expect(before.platformRevenuePaise + before.examinerEarnedPaise).toBe(
      before.grossPaise - before.refundedPaise,
    );

    await ctx
      .http()
      .post('/admin/finance/payouts')
      .set(auth(admin))
      .send({ examinerId: trainerRow.id, amountPaise: 10_000, utr: 'UTR123456' })
      .expect(200);
    const after = (await get(admin, `/admin/reports/monthly?month=${month()}`).expect(200)).body;
    expect(after.paidOutPaise).toBe(10_000);
    expect(after.owedAtMonthEndPaise).toBe(3 * 7_450 - 10_000);
    expect(after.payableNowPaise).toBe(3 * 7_450 - 10_000);
  });

  it('keeps months apart and answers for an empty month', async () => {
    await students(1);
    const lastMonth = monthOf(new Date(Date.now() - 40 * 86_400_000));
    const empty = (await get(admin, `/admin/reports/monthly?month=${lastMonth}`).expect(200)).body;
    expect(empty.grossPaise).toBe(0);
    expect(empty.owedAtMonthEndPaise).toBe(0);
    expect(empty.examiners).toEqual([]);
  });

  it('counts a month from midnight India time', () => {
    const { start, end } = monthRange('2026-03');
    expect(start.toISOString()).toBe('2026-02-28T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(monthOf(new Date('2026-02-28T18:30:00Z'))).toBe('2026-03');
    expect(monthOf(new Date('2026-02-28T18:29:59Z'))).toBe('2026-02');
  });

  it('validates the month', async () => {
    await get(admin, '/admin/reports/monthly?month=2026-13').expect(400);
    await get(admin, '/admin/reports/monthly').expect(400);
  });

  it('gives a month-by-month series, oldest first, ending this month', async () => {
    await students(1);
    const s = (await get(admin, '/admin/reports/series?months=3').expect(200)).body;
    expect(s).toHaveLength(3);
    expect(s[2].month).toBe(month());
    expect(s[2].grossPaise).toBe(19_900 + 14_900);
    expect(s[0].grossPaise).toBe(0);
    expect(s[0].month < s[1].month && s[1].month < s[2].month).toBe(true);
  });
});

describe('overview, exams and audit log', () => {
  it('summarises the platform and confirms the ledger balances', async () => {
    await students(2);
    const o = (await get(admin, '/admin/overview').expect(200)).body;
    expect(o.users).toMatchObject({ students: 2, examiners: 1, admins: 1, suspended: 0 });
    expect(o.exams).toMatchObject({ total: 1, live: 1 });
    expect(o.enrollments).toBe(2);
    expect(o.ledgerBalanced).toBe(true);
  });

  it('lists and searches exams across trainers', async () => {
    await students(2);
    const all = (await get(admin, '/admin/exams').expect(200)).body;
    expect(all.total).toBe(1);
    expect(all.rows[0]).toMatchObject({
      title: 'Cloud Fundamentals',
      status: 'PUBLISHED',
      enrollments: 2,
      trainerEmail: 'trainer@example.com',
    });
    expect((await get(admin, '/admin/exams?q=cloud').expect(200)).body.total).toBe(1);
    expect((await get(admin, `/admin/exams?q=${exam.code}`).expect(200)).body.total).toBe(1);
    expect((await get(admin, '/admin/exams?q=TRAINER@').expect(200)).body.total).toBe(1);
    expect((await get(admin, '/admin/exams?q=nothing-like-this').expect(200)).body.total).toBe(0);
    expect((await get(admin, '/admin/exams?status=DRAFT').expect(200)).body.total).toBe(0);
  });

  it('shows who did what in the audit log, newest first, and filters it', async () => {
    const stu = await newStudent(ctx, 'sam@example.com');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'sam@example.com' } });
    await ctx
      .http()
      .patch(`/admin/users/${user.id}/status`)
      .set(auth(admin))
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(stu).toBeDefined();
    const log = (await get(admin, '/admin/audit').expect(200)).body;
    expect(log.rows[0]).toMatchObject({ action: 'admin.user_suspended', actorName: 'Admin' });
    const only = (await get(admin, '/admin/audit?action=suspended').expect(200)).body;
    expect(only.total).toBe(1);
  });

  it('searches users, and marks an email verified', async () => {
    await ctx.prisma.user.create({
      data: {
        email: 'migrated@example.com',
        name: 'Migrated Mina',
        passwordHash: 'x',
        role: 'STUDENT',
      },
    });
    const found = (await get(admin, '/admin/users?q=mina').expect(200)).body;
    expect(found.total).toBe(1);
    const id = found.users[0].id;
    expect(found.users[0].emailVerifiedAt).toBeNull();
    await ctx.http().patch(`/admin/users/${id}/verify`).set(auth(admin)).expect(200);
    const again = (await get(admin, '/admin/users?q=mina').expect(200)).body;
    expect(again.users[0].emailVerifiedAt).not.toBeNull();
    await ctx.http().patch(`/admin/users/${id}/verify`).set(auth(trainer)).expect(403);
  });
});

describe('platform settings', () => {
  it('starts with the standard prices', async () => {
    // Nothing saved yet: the platform defaults apply (Rs 99 to publish, Rs 49 to join).
    await ctx.prisma.platformSetting.deleteMany();
    const s = (await get(admin, '/admin/settings').expect(200)).body;
    expect(s).toEqual({
      examCreationPaise: 9_900,
      examJoinPaise: 4_900,
      examinerSharePercent: 50,
      minPayoutPaise: 50_000,
    });
  });

  it('validates what an admin enters', async () => {
    const ok = {
      examCreationPaise: 19_900,
      examJoinPaise: 14_900,
      examinerSharePercent: 50,
      minPayoutPaise: 50_000,
    };
    await put(admin, '/admin/settings', { ...ok, examinerSharePercent: 101 }).expect(400);
    await put(admin, '/admin/settings', { ...ok, examJoinPaise: -1 }).expect(400);
    await put(admin, '/admin/settings', { ...ok, examJoinPaise: 99.5 }).expect(400);
    await put(admin, '/admin/settings', { ...ok, examJoinPaise: 0 }).expect(400);
    await put(admin, '/admin/settings', { ...ok, examCreationPaise: 99 }).expect(400);
    await put(admin, '/admin/settings', { ...ok, minPayoutPaise: undefined }).expect(400);
  });

  it('applies a new join fee and split to later payments only, and logs the change', async () => {
    const [first] = await students(1); // paid 149.00, split 50/50
    expect(first).toBeDefined();
    await put(admin, '/admin/settings', {
      examCreationPaise: 29_900,
      examJoinPaise: 20_000,
      examinerSharePercent: 60,
      minPayoutPaise: 10_000,
    }).expect(200);

    // the join page now shows the new fee
    const lena = await newStudent(ctx, 'lena@example.com');
    const info = (await get(lena, `/join/${exam.code}`).expect(200)).body;
    expect(info.feePaise).toBe(20_000);
    await joinExam(ctx, lena, exam.code);

    const joins = await ctx.prisma.payment.findMany({
      where: { purpose: 'EXAM_JOIN' },
      orderBy: { createdAt: 'asc' },
    });
    expect(joins.map((p) => p.amountPaise)).toEqual([14_900, 20_000]);

    // 7,450 from the first payment (50%) + 12,000 from the second (60%)
    const r = (await get(admin, `/admin/reports/monthly?month=${month()}`).expect(200)).body;
    expect(r.examinerEarnedPaise).toBe(7_450 + 12_000);
    expect(r.platformRevenuePaise + r.examinerEarnedPaise).toBe(r.grossPaise);
    const ledger = (await get(admin, '/admin/finance/ledger').expect(200)).body;
    expect(ledger.totalPaise).toBe(0);

    const log = (await get(admin, '/admin/audit?action=settings_changed').expect(200)).body;
    expect(log.total).toBe(1);
    expect(log.rows[0].meta.after.examJoinPaise).toBe(20_000);
  });

  it('charges the new publish fee, and the new minimum payout applies', async () => {
    await put(admin, '/admin/settings', {
      examCreationPaise: 29_900,
      examJoinPaise: 14_900,
      examinerSharePercent: 50,
      minPayoutPaise: 5_000,
    }).expect(200);
    const draft = await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Second exam', ...window() })
      .expect(201);
    await ctx
      .http()
      .post(`/exams/${draft.body.id}/questions`)
      .set(auth(trainer))
      .send({ type: 'SINGLE', body: 'Q?', options: ['a', 'b'], correctOptions: [0], marks: 1 })
      .expect(201);
    const order = (
      await ctx.http().post(`/exams/${draft.body.id}/publish-order`).set(auth(trainer)).expect(200)
    ).body;
    expect(order.amountPaise).toBe(29_900);

    // 100 in the minimum is now 50.00, so a trainer with 74.50 payable may ask for a payout
    await students(1);
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });
    const { LedgerService } = await import('../ledger/ledger.service');
    const trainerId = (
      await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'trainer@example.com' } })
    ).id;
    const e = await ctx.app.get(LedgerService).balances(trainerId);
    expect(e.minPayoutPaise).toBe(5_000);
  });

  it('does not reuse an unpaid order made at the old price', async () => {
    const first = (await ctx.http().post(`/exams/${exam.examId}/publish-order`).set(auth(trainer)))
      .status;
    // the exam is already published, so the order is refused; use a fresh draft instead
    expect(first).toBeGreaterThanOrEqual(400);
    const draft = await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Third exam', ...window() })
      .expect(201);
    await ctx
      .http()
      .post(`/exams/${draft.body.id}/questions`)
      .set(auth(trainer))
      .send({ type: 'SINGLE', body: 'Q?', options: ['a', 'b'], correctOptions: [0], marks: 1 })
      .expect(201);
    const a = (
      await ctx.http().post(`/exams/${draft.body.id}/publish-order`).set(auth(trainer)).expect(200)
    ).body;
    expect(a.amountPaise).toBe(19_900);
    await put(admin, '/admin/settings', {
      examCreationPaise: 25_000,
      examJoinPaise: 14_900,
      examinerSharePercent: 50,
      minPayoutPaise: 50_000,
    }).expect(200);
    const b = (
      await ctx.http().post(`/exams/${draft.body.id}/publish-order`).set(auth(trainer)).expect(200)
    ).body;
    expect(b.amountPaise).toBe(25_000);
    expect(b.orderId).not.toBe(a.orderId);
  });
});
