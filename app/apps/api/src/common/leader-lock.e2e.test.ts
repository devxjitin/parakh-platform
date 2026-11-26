import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { TestContext, createTestApp } from '../../test/helpers';
import { withLeaderLock } from './leader-lock';

let ctx: TestContext;
let prisma: PrismaService;

beforeAll(async () => {
  ctx = await createTestApp();
  prisma = ctx.app.get(PrismaService);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('withLeaderLock', () => {
  it('lets only one server run a job at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;

    const first = withLeaderLock(prisma, 'test-job', async () => {
      runs++;
      await gate;
    });
    await new Promise((r) => setTimeout(r, 200));
    const second = await withLeaderLock(prisma, 'test-job', async () => {
      runs++;
    });
    expect(second).toBe(false);

    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);

    // Once the first pass ends, the next one can run.
    expect(await withLeaderLock(prisma, 'test-job', async () => void runs++)).toBe(true);
    expect(runs).toBe(2);
  });

  it('does not block jobs with a different name', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withLeaderLock(prisma, 'job-a', () => gate);
    await new Promise((r) => setTimeout(r, 200));
    expect(await withLeaderLock(prisma, 'job-b', async () => undefined)).toBe(true);
    release();
    await a;
  });
});
