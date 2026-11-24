import { Algorithm, hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, TestContext, createTestApp, refreshCookie } from '../../test/helpers';

// Limits are off in tests by default; this file turns them on, with a small sign-in ceiling so the
// ceiling itself can be tested. These must be set before the app is created.
process.env.RATE_LIMIT_TEST = 'on';
process.env.RATE_LIMIT_LOGIN_IP_PER_MIN = '40';

let ctx: TestContext;
let passwordHash: string;

beforeAll(async () => {
  ctx = await createTestApp();
  passwordHash = await hash(PASSWORD, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  // Lets a test pretend to be a different network with the X-Forwarded-For header.
  ctx.app.getHttpAdapter().getInstance().set('trust proxy', 1);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  // A new window for every test: the counters live in the running app.
});

const login = (email: string, password = PASSWORD, ip?: string) => {
  const req = ctx.http().post('/auth/login');
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send({ email, password });
};

async function makeStudents(n: number, prefix: string) {
  const emails = Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);
  await ctx.prisma.user.createMany({
    data: emails.map((email, i) => ({
      email,
      name: `Student ${i}`,
      passwordHash,
      role: 'EXAMINER' as const,
      emailVerifiedAt: new Date(),
    })),
  });
  return emails;
}

describe('a classroom behind one IP address', () => {
  it('lets 30 students sign in within a minute (the old limit stopped the 11th)', async () => {
    const emails = await makeStudents(30, 'class');
    const statuses = [];
    for (const email of emails) statuses.push((await login(email)).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('lets many browsers renew their session from one IP (the old limit was 30 a minute)', async () => {
    const [email] = await makeStudents(1, 'renew');
    const first = await login(email).expect(200);
    let cookie = refreshCookie(first)!;
    for (let i = 0; i < 40; i++) {
      const res = await ctx.http().post('/auth/refresh').set('Cookie', cookie).expect(200);
      cookie = refreshCookie(res)!;
    }
  });
});

describe('stopping password guessing without locking anyone else out', () => {
  it('limits one email from one network, with a Retry-After, and nobody else', async () => {
    const [victim, classmate] = await makeStudents(2, 'guess');
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await login(victim, PASSWORD, '203.0.113.5'));
    expect(results.slice(0, 10).every((r) => r.status === 200)).toBe(true);
    expect(results[10].status).toBe(429);
    expect(Number(results[10].headers['retry-after'])).toBeGreaterThan(0);

    // The real owner on another network is not locked out, and neither is a classmate.
    await login(victim, PASSWORD, '198.51.100.7').expect(200);
    await login(classmate, PASSWORD, '203.0.113.5').expect(200);
  });

  it('does not count malformed requests, which get the normal 400', async () => {
    for (let i = 0; i < 15; i++) {
      await ctx
        .http()
        .post('/auth/login')
        .set('X-Forwarded-For', '198.18.0.9')
        .send({ password: PASSWORD })
        .expect(400);
    }
  });

  it('still has a ceiling per IP, set from the environment', async () => {
    const statuses: number[] = [];
    // 45 different unknown emails from one address; the ceiling in this file is 40 a minute.
    for (let i = 0; i < 45; i++) {
      statuses.push((await login(`nobody${i}@example.com`, PASSWORD, '192.0.2.77')).status);
    }
    expect(statuses.slice(0, 40).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(40).every((s) => s === 429)).toBe(true);
  });
});

describe('stopping email flooding', () => {
  it('allows 5 emails a minute to one address from anywhere, then refuses, without touching others', async () => {
    const send = (email: string, ip: string) =>
      ctx.http().post('/auth/forgot-password').set('X-Forwarded-For', ip).send({ email });
    for (let i = 0; i < 5; i++) await send('target@example.com', `203.0.113.${i + 10}`).expect(202);
    // A sixth, even from a brand-new network, is refused: the inbox is protected.
    await send('target@example.com', '203.0.113.99').expect(429);
    // Another address is unaffected.
    await send('someone-else@example.com', '203.0.113.99').expect(202);
  });
});
