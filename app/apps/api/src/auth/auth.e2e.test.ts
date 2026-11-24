import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '@parakh/shared';
import {
  PASSWORD,
  TestContext,
  createTestApp,
  lastCode,
  rawSetCookie,
  refreshCookie,
  signUp,
} from '../../test/helpers';

import { AuthCleanupService } from './auth-cleanup.service';

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

describe('registration and email verification', () => {
  it("replaces a squatter's password and role when the real owner re-registers", async () => {
    const email = 'victim@example.com';
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Squatter',
        email,
        password: 'Attacker-pass-1234',
        role: 'EXAMINER',
      })
      .expect(202);
    await ctx
      .http()
      .post('/auth/register')
      .send({ acceptTerms: true, name: 'Real Owner', email, password: PASSWORD, role: 'EXAMINER' })
      .expect(202);
    const code = lastCode(ctx.mail, email);
    await ctx.http().post('/auth/verify-email').send({ email, code }).expect(200);

    await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: 'Attacker-pass-1234' })
      .expect(401);
    const ok = await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(ok.body.user.role).toBe('EXAMINER');
  });

  it('registers, emails a code, and refuses login until the email is verified', async () => {
    const email = 'new@example.com';
    const reg = await ctx
      .http()
      .post('/auth/register')
      .send({ acceptTerms: true, name: 'New User', email, password: PASSWORD, role: 'EXAMINER' })
      .expect(202);
    expect(reg.body.accessToken).toBeUndefined();
    expect(ctx.mail.lastTo(email)?.subject).toMatch(/verify/i);

    const blocked = await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong code, accepts the right one, and starts a session', async () => {
    const email = 'verify@example.com';
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Verify Me',
        email,
        password: PASSWORD,
        role: 'EXAMINER',
        orgName: 'Acme Academy',
      })
      .expect(202);
    const code = lastCode(ctx.mail, email);
    const wrong = code === '000000' ? '111111' : '000000';

    await ctx.http().post('/auth/verify-email').send({ email, code: wrong }).expect(400);
    const ok = await ctx.http().post('/auth/verify-email').send({ email, code }).expect(200);

    expect(ok.body.user).toMatchObject({ email, role: 'EXAMINER', orgName: 'Acme Academy' });
    expect(ok.body.user.emailVerifiedAt).toBeTruthy();
    expect(ok.body.user.passwordHash).toBeUndefined();

    const cookie = rawSetCookie(ok);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/auth/);

    // The same code cannot be used twice.
    await ctx.http().post('/auth/verify-email').send({ email, code }).expect(400);
  });

  it('locks a code after too many wrong guesses', async () => {
    const email = 'brute@example.com';
    await ctx
      .http()
      .post('/auth/register')
      .send({ acceptTerms: true, name: 'Brute', email, password: PASSWORD, role: 'EXAMINER' })
      .expect(202);
    const code = lastCode(ctx.mail, email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await ctx.http().post('/auth/verify-email').send({ email, code: wrong }).expect(400);
    }
    // Even the correct code no longer works; the user must request a new one.
    await ctx.http().post('/auth/verify-email').send({ email, code }).expect(400);
  });

  it('requires accepting the terms and records which version was accepted', async () => {
    const body = {
      name: 'Consent',
      email: 'consent@example.com',
      password: PASSWORD,
      role: 'EXAMINER',
    };
    const refused = await ctx.http().post('/auth/register').send(body).expect(400);
    expect(Object.keys(refused.body.errors)).toContain('acceptTerms');
    await ctx
      .http()
      .post('/auth/register')
      .send({ ...body, acceptTerms: false })
      .expect(400);
    expect(await ctx.prisma.user.count()).toBe(0);

    await ctx
      .http()
      .post('/auth/register')
      .send({ ...body, acceptTerms: true })
      .expect(202);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.termsVersion).toBe(LEGAL_VERSION);
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('tells the person when an email is already registered', async () => {
    const { email } = await signUp(ctx, { email: 'taken@example.com' });
    ctx.mail.clear();
    const again = await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Someone Else',
        email,
        password: 'AnotherPass123',
        role: 'EXAMINER',
      })
      .expect(409);
    expect(again.body.message).toMatch(/already exists/i);
    expect(ctx.mail.lastTo(email)).toBeUndefined();
    expect(await ctx.prisma.user.count()).toBe(1);
  });

  it('cannot register as ADMIN', async () => {
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Sneaky',
        email: 'sneaky@example.com',
        password: PASSWORD,
        role: 'ADMIN',
      })
      .expect(400);
    expect(await ctx.prisma.user.count()).toBe(0);
  });

  it('validates input', async () => {
    const res = await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'X',
        email: 'not-an-email',
        password: 'short',
        role: 'EXAMINER',
      })
      .expect(400);
    expect(Object.keys(res.body.errors)).toEqual(
      expect.arrayContaining(['name', 'email', 'password']),
    );
  });

  it('stores passwords as argon2id hashes and never stores the OTP', async () => {
    const { email } = await signUp(ctx);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    const otps = await ctx.prisma.emailOtp.findMany();
    expect(otps.every((o) => o.codeHash.length === 64)).toBe(true);
  });
});

describe('login', () => {
  it('logs in and returns the public user only', async () => {
    const { email } = await signUp(ctx, { role: 'EXAMINER', orgName: 'Org' });
    const res = await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.expiresInSeconds).toBe(900);
    expect(Object.keys(res.body.user).sort()).toEqual(
      ['createdAt', 'email', 'emailVerifiedAt', 'id', 'name', 'orgName', 'phone', 'role'].sort(),
    );
  });

  it('gives the same error for wrong password and unknown email', async () => {
    const { email } = await signUp(ctx);
    const wrongPw = await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: 'Wrong-password-1' })
      .expect(401);
    const unknown = await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong-password-1' })
      .expect(401);
    expect(wrongPw.body.message).toBe(unknown.body.message);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const { email } = await signUp(ctx);
    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .post('/auth/login')
        .send({ email, password: 'Wrong-password-1' })
        .expect(401);
    }
    await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(429);
  });

  it("locks one email+IP pair, not the owner's account, and clears when the owner signs in elsewhere", async () => {
    const { email } = await signUp(ctx);
    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .post('/auth/login')
        .send({ email, password: 'Wrong-password-1' })
        .expect(401);
    }
    await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(429);
    const user = await ctx.prisma.user.findUnique({ where: { email } });
    expect(user?.lockedUntil).toBeNull();
    // Another network has no lock: simulate it by removing this pair's row.
    await ctx.prisma.loginFailure.deleteMany({ where: { email } });
    await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('cleans up stale failure rows and week-old unverified sign-ups, keeping paid or fresh ones', async () => {
    const cleanup = ctx.app.get(AuthCleanupService);
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Old',
        email: 'old@example.com',
        password: PASSWORD,
        role: 'EXAMINER',
      })
      .expect(202);
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'New',
        email: 'fresh@example.com',
        password: PASSWORD,
        role: 'EXAMINER',
      })
      .expect(202);
    await ctx.prisma.user.update({
      where: { email: 'old@example.com' },
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await ctx.prisma.loginFailure.create({
      data: {
        email: 'x@example.com',
        ip: '1.1.1.1',
        count: 1,
        updatedAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });
    const res = await cleanup.runOnce();
    expect(res.users).toBe(1);
    expect(await ctx.prisma.user.findUnique({ where: { email: 'old@example.com' } })).toBeNull();
    expect(
      await ctx.prisma.user.findUnique({ where: { email: 'fresh@example.com' } }),
    ).not.toBeNull();
  });

  it('normalises email case', async () => {
    const { email } = await signUp(ctx, { email: 'mixed@example.com' });
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);
  });
});

describe('sessions: access and refresh tokens', () => {
  it('protects routes and accepts a valid access token', async () => {
    const { accessToken } = await signUp(ctx);
    await ctx.http().get('/users/me').expect(401);
    await ctx.http().get('/users/me').set('Authorization', 'Bearer garbage').expect(401);
    const me = await ctx
      .http()
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('EXAMINER');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const { cookie: first } = await signUp(ctx);

    const second = await ctx.http().post('/auth/refresh').set('Cookie', first).expect(200);
    const secondCookie = refreshCookie(second)!;
    expect(secondCookie).toBeTruthy();
    expect(secondCookie).not.toBe(first);
    expect(second.body.accessToken).toBeTruthy();

    // Once the grace window has passed, replaying the old token is theft: it fails AND kills the family.
    await ctx.prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await ctx.http().post('/auth/refresh').set('Cookie', first).expect(401);
    await ctx.http().post('/auth/refresh').set('Cookie', secondCookie).expect(401);

    const events = await ctx.prisma.auditLog.findMany({
      where: { action: 'auth.refresh_reuse_detected' },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('lets a second tab refresh with the same cookie right after the first, without logging out', async () => {
    const { cookie: first } = await signUp(ctx);

    // Two tabs restore together and both send the same cookie.
    const a = await ctx.http().post('/auth/refresh').set('Cookie', first).expect(200);
    const b = await ctx.http().post('/auth/refresh').set('Cookie', first).expect(200);
    expect(refreshCookie(b)).toBeTruthy();

    // The family survives: both new cookies still work.
    await ctx.http().post('/auth/refresh').set('Cookie', refreshCookie(a)!).expect(200);
    await ctx.http().post('/auth/refresh').set('Cookie', refreshCookie(b)!).expect(200);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } }),
    ).toBe(0);
  });

  it('refresh fails without a cookie', async () => {
    await ctx.http().post('/auth/refresh').expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const { cookie } = await signUp(ctx);
    await ctx.http().post('/auth/logout').set('Cookie', cookie).expect(204);
    await ctx.http().post('/auth/refresh').set('Cookie', cookie).expect(401);
  });
});

describe('password reset', () => {
  it('resets with an emailed code, signs out other sessions, and accepts the new password', async () => {
    const { email, cookie } = await signUp(ctx);
    ctx.mail.clear();

    await ctx.http().post('/auth/forgot-password').send({ email }).expect(202);
    const code = lastCode(ctx.mail, email);

    const newPassword = 'BrandNewPass456';
    await ctx.http().post('/auth/reset-password').send({ email, code, newPassword }).expect(200);

    await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(401);
    await ctx.http().post('/auth/login').send({ email, password: newPassword }).expect(200);
    // The session from before the reset is dead.
    await ctx.http().post('/auth/refresh').set('Cookie', cookie).expect(401);
    expect(ctx.mail.lastTo(email)?.subject).toMatch(/changed/i);
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const res = await ctx
      .http()
      .post('/auth/forgot-password')
      .send({ email: 'ghost@example.com' })
      .expect(202);
    expect(res.body.message).toBeTruthy();
    expect(ctx.mail.outbox).toHaveLength(0);
  });

  it('rejects a bad reset code', async () => {
    const { email } = await signUp(ctx);
    await ctx.http().post('/auth/forgot-password').send({ email }).expect(202);
    await ctx
      .http()
      .post('/auth/reset-password')
      .send({
        email,
        code: '123456' === lastCode(ctx.mail, email) ? '654321' : '123456',
        newPassword: 'BrandNewPass456',
      })
      .expect(400);
  });

  it('rate-limits code resends per user', async () => {
    const { email } = await signUp(ctx);
    ctx.mail.clear();
    await ctx.http().post('/auth/forgot-password').send({ email }).expect(202);
    await ctx.http().post('/auth/forgot-password').send({ email }).expect(202);
    // The second request is within the cooldown, so only one email was sent.
    expect(ctx.mail.outbox).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('records registration, verification and login without secrets', async () => {
    const { email } = await signUp(ctx);
    await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const actions = (await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['auth.register', 'auth.verify_email', 'auth.login']),
    );
    const raw = JSON.stringify(await ctx.prisma.auditLog.findMany());
    expect(raw).not.toContain(PASSWORD);
  });
});
