import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

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
const post = (who: Token, url: string, body: object = {}) =>
  ctx.http().post(url).set(auth(who)).send(body);

describe('my payments', () => {
  it('lists only my own paid payments with a receipt, for trainers and students', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    const lee = await newStudent(ctx, 'lee@example.com');
    await joinExam(ctx, lee, exam.code);

    const mine = (await get(sam, '/me/payments').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      purpose: 'EXAM_JOIN',
      description: 'Exam fee',
      status: 'CAPTURED',
      amountPaise: 14_900,
      examTitle: 'Cloud Fundamentals',
    });
    expect(mine[0].receiptNo).toMatch(/^PRK-R-\d+$/);

    const receipt = (await get(sam, `/me/payments/${mine[0].id}`).expect(200)).body;
    expect(receipt).toMatchObject({ payerEmail: 'sam@example.com', payerName: 'Sam Student' });
    expect(receipt.note).toMatch(/not a GST tax invoice/);

    // Someone else's receipt looks like it does not exist.
    await get(lee, `/me/payments/${mine[0].id}`).expect(404);
    await get(lee, '/me/payments/not-a-uuid').expect(404);

    // The trainer sees the creation fee they paid, not their students' fees.
    const theirs = (await get(trainer, '/me/payments').expect(200)).body;
    expect(theirs.map((p: { purpose: string }) => p.purpose)).toEqual(['EXAM_CREATION']);
    await get(admin, '/me/payments').expect(403);
  });
});
