import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, TestContext, createAdmin, createTestApp, signUp } from '../../test/helpers';

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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('role-based access control', () => {
  it('health is public and reports the database', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('admin routes: 401 without a token, 403 for students and examiners, 200 for admins', async () => {
    const student = await signUp(ctx, { role: 'STUDENT' });
    const examiner = await signUp(ctx, { role: 'EXAMINER' });
    const admin = await createAdmin(ctx);

    await ctx.http().get('/admin/users').expect(401);
    await ctx.http().get('/admin/users').set(bearer(student.accessToken)).expect(403);
    await ctx.http().get('/admin/users').set(bearer(examiner.accessToken)).expect(403);

    const res = await ctx.http().get('/admin/users').set(bearer(admin.accessToken)).expect(200);
    expect(res.body.total).toBe(3);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const filtered = await ctx
      .http()
      .get('/admin/users?role=EXAMINER')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(filtered.body.users).toHaveLength(1);
  });

  it('suspending a user blocks their token, login and refresh immediately', async () => {
    const student = await signUp(ctx, { email: 'victim@example.com' });
    const admin = await createAdmin(ctx);
    const target = await ctx.prisma.user.findUniqueOrThrow({ where: { email: student.email } });

    await ctx
      .http()
      .patch(`/admin/users/${target.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'SUSPENDED' })
      .expect(200);

    await ctx.http().get('/users/me').set(bearer(student.accessToken)).expect(401);
    await ctx.http().post('/auth/refresh').set('Cookie', student.cookie).expect(401);
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: student.email, password: PASSWORD })
      .expect(403);

    await ctx
      .http()
      .patch(`/admin/users/${target.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'ACTIVE' })
      .expect(200);
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: student.email, password: PASSWORD })
      .expect(200);

    const audit = await ctx.prisma.auditLog.findMany({
      where: { action: { startsWith: 'admin.user_' } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'admin.user_reactivated',
      'admin.user_suspended',
    ]);
  });

  it('admins cannot suspend themselves', async () => {
    const admin = await createAdmin(ctx);
    const me = await ctx.prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
    await ctx
      .http()
      .patch(`/admin/users/${me.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'SUSPENDED' })
      .expect(400);
  });
});

describe('profile', () => {
  it('lets a user update their own profile and records it in the audit log', async () => {
    const { accessToken } = await signUp(ctx, { role: 'EXAMINER', orgName: 'Old Org' });
    const res = await ctx
      .http()
      .patch('/users/me')
      .set(bearer(accessToken))
      .send({ name: 'Renamed Person', phone: '+919876543210', orgName: 'New Org' })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Renamed Person',
      phone: '+919876543210',
      orgName: 'New Org',
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'user.profile_updated' } })).toBe(1);
  });

  it('ignores organisation for students and rejects invalid fields', async () => {
    const { accessToken } = await signUp(ctx, { role: 'STUDENT' });
    const res = await ctx
      .http()
      .patch('/users/me')
      .set(bearer(accessToken))
      .send({ orgName: 'Not Allowed' })
      .expect(200);
    expect(res.body.orgName).toBeNull();
    await ctx.http().patch('/users/me').set(bearer(accessToken)).send({ phone: 'abc' }).expect(400);
  });

  it('cannot change role or email through the profile endpoint', async () => {
    const { accessToken, email } = await signUp(ctx, { role: 'STUDENT' });
    const res = await ctx
      .http()
      .patch('/users/me')
      .set(bearer(accessToken))
      .send({ role: 'ADMIN', email: 'other@example.com' })
      .expect(200);
    expect(res.body.role).toBe('STUDENT');
    expect(res.body.email).toBe(email);
  });

  it('changes password with the current one, and signs out old sessions', async () => {
    const { email, accessToken, cookie } = await signUp(ctx);
    await ctx
      .http()
      .post('/users/me/change-password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'wrong-current-1', newPassword: 'NewPassword789' })
      .expect(401);

    const ok = await ctx
      .http()
      .post('/users/me/change-password')
      .set(bearer(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword789' })
      .expect(200);
    expect(ok.body.accessToken).toBeTruthy();

    await ctx.http().post('/auth/refresh').set('Cookie', cookie).expect(401);
    await ctx.http().post('/auth/login').send({ email, password: 'NewPassword789' }).expect(200);
  });
});
