import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp } from '../../test/helpers';
import { auth } from '../../test/scenario';
import { LOAD_DOMAIN, cleanupLoadTest, seedLoadTest } from './seed-load-test';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
});

describe('load-test seed', () => {
  it('makes students who can sign in and sit the exam, and cleanup removes only them', async () => {
    // Real data that must survive the cleanup.
    const keeper = await ctx.prisma.user.create({
      data: {
        email: 'keeper@example.com',
        name: 'Keeper',
        passwordHash: 'x',
        role: 'STUDENT',
        emailVerifiedAt: new Date(),
      },
    });

    const seeded = await seedLoadTest(ctx.prisma, {
      students: 3,
      minutes: 30,
      password: 'Load-Test-pass1',
    });
    expect(seeded.emails).toHaveLength(3);
    expect(await ctx.prisma.question.count({ where: { examId: seeded.examId } })).toBe(20);
    expect(await ctx.prisma.enrollment.count({ where: { examId: seeded.examId } })).toBe(3);
    await expect(
      seedLoadTest(ctx.prisma, { students: 1, minutes: 30, password: 'Load-Test-pass1' }),
    ).rejects.toThrow(/cleanup/);

    // The exact steps the k6 script performs.
    expect(seeded.refreshTokens).toHaveLength(3);
    const login = (
      await ctx
        .http()
        .post('/auth/refresh')
        .set('Cookie', `prk_rt=${seeded.refreshTokens[0]}`)
        .expect(200)
    ).body;
    expect(login.user.email).toBe(seeded.emails[0]);
    const enrollments = (await ctx.http().get('/me/enrollments').set(auth(login)).expect(200)).body;
    expect(enrollments).toHaveLength(1);
    const attempt = (
      await ctx
        .http()
        .post('/attempts')
        .set(auth(login))
        .send({ enrollmentId: enrollments[0].enrollmentId ?? enrollments[0].id })
        .expect(200)
    ).body;
    const state = (await ctx.http().get(`/attempts/${attempt.id}`).set(auth(login)).expect(200))
      .body;
    expect(state.questions).toHaveLength(20);
    await ctx
      .http()
      .put(`/attempts/${attempt.id}/answers/${state.questions[0].id}`)
      .set(auth(login))
      .send({ selected: [0] })
      .expect(200);
    await ctx.http().post(`/attempts/${attempt.id}/submit`).set(auth(login)).expect(200);

    const { users } = await cleanupLoadTest(ctx.prisma);
    expect(users).toBe(4); // 3 students and the trainer
    expect(await ctx.prisma.user.count({ where: { email: { endsWith: `@${LOAD_DOMAIN}` } } })).toBe(
      0,
    );
    expect(await ctx.prisma.exam.count()).toBe(0);
    expect(await ctx.prisma.attempt.count()).toBe(0);
    expect(await ctx.prisma.user.findUnique({ where: { id: keeper.id } })).not.toBeNull();
  });
});
