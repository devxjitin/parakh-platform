import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TestContext,
  createAdmin,
  createTestApp,
  lastCode,
  refreshCookie,
  signUp,
} from '../../test/helpers';
import { auth, publishExam } from '../../test/scenario';
import { NotificationsService } from '../notifications/notifications.service';

let ctx: TestContext;
let trainer: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

/** The whole student path with no account: code, name + email, emailed code, then a session. */
async function joinWithEmail(code: string, email: string, name = 'Asha Rao') {
  await ctx
    .http()
    .post(`/auth/join/${code}/start`)
    .send({ name, email, acceptTerms: true })
    .expect(202);
  const res = await ctx
    .http()
    .post('/auth/join/verify')
    .send({ name, email, code: lastCode(ctx.mail, email) })
    .expect(200);
  return {
    accessToken: res.body.accessToken as string,
    user: res.body.user,
    cookie: refreshCookie(res),
  };
}

async function pay(student: { accessToken: string }, code: string) {
  const order = (await ctx.http().post(`/join/${code}/order`).set(auth(student)).expect(200)).body;
  const paid = (
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(student))
      .send({ orderId: order.orderId })
      .expect(200)
  ).body;
  return (await ctx.http().post('/payments/verify').set(auth(student)).send(paid).expect(200)).body;
}

describe('students join with a code and an emailed code (no registration)', () => {
  it('goes code, name + email, emailed code, pay, receipt, start', async () => {
    const exam = await publishExam(ctx, trainer);
    const info = (await ctx.http().get(`/join/${exam.code}`).expect(200)).body;
    expect(info).toMatchObject({ feePaise: 14900, nandivexHosted: false });

    const asha = await joinWithEmail(exam.code, 'asha@example.com');
    expect(asha.user).toMatchObject({
      role: 'STUDENT',
      name: 'Asha Rao',
      email: 'asha@example.com',
    });
    expect(asha.cookie).toBeTruthy();

    const done = await pay(asha, exam.code);
    expect(done.enrollmentId).toBeTruthy();
    const receipt = ctx.mail.lastTo('asha@example.com');
    expect(receipt?.subject).toMatch(/^Receipt PRK-R-\d+: you have joined/);
    expect(receipt?.text).toContain(`/join/?code=${exam.code}`);

    const attempt = await ctx
      .http()
      .post('/attempts')
      .set(auth(asha))
      .send({ enrollmentId: done.enrollmentId })
      .expect(200);
    expect(attempt.body.id).toBeTruthy();
  });

  it('lets the same person come back later with a fresh emailed code', async () => {
    const exam = await publishExam(ctx, trainer, { startsAt: hours(2), endsAt: hours(5) });
    const first = await joinWithEmail(exam.code, 'asha@example.com');
    await pay(first, exam.code);

    // the resend wait only matters within seconds; clear the old code to simulate a later visit
    await ctx.prisma.emailOtp.deleteMany({});
    const back = await joinWithEmail(exam.code, 'asha@example.com', 'Asha R');
    expect(back.user.name).toBe('Asha R');
    const mine = (await ctx.http().get(`/join/${exam.code}/mine`).set(auth(back)).expect(200)).body;
    expect(mine).toMatchObject({ exam: { id: exam.examId }, canStart: false });
    expect(await ctx.prisma.user.count({ where: { email: 'asha@example.com' } })).toBe(1);
  });

  it('has no student registration and no student password sign-in', async () => {
    await ctx
      .http()
      .post('/auth/register')
      .send({
        acceptTerms: true,
        name: 'Stu',
        email: 'stu@example.com',
        password: 'CorrectHorse9battery',
        role: 'STUDENT',
      })
      .expect(400);
    const exam = await publishExam(ctx, trainer);
    await joinWithEmail(exam.code, 'asha@example.com');
    for (const password of ['CorrectHorse9battery', '!no-password', 'x']) {
      await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'asha@example.com', password })
        .expect((r) => expect([400, 401]).toContain(r.status));
    }
  });

  it('rejects a wrong emailed code, a trainer email and an unknown exam', async () => {
    const exam = await publishExam(ctx, trainer);
    await ctx
      .http()
      .post(`/auth/join/${exam.code}/start`)
      .send({ name: 'Asha Rao', email: 'asha@example.com', acceptTerms: true })
      .expect(202);
    await ctx
      .http()
      .post('/auth/join/verify')
      .send({ name: 'Asha Rao', email: 'asha@example.com', code: '000000' })
      .expect(400);
    // an email that belongs to a trainer cannot be used as a student
    await ctx
      .http()
      .post(`/auth/join/${exam.code}/start`)
      .send({ name: 'Trainer', email: 'trainer@example.com', acceptTerms: true })
      .expect(409);
    await ctx
      .http()
      .post('/auth/join/NVX-ZZZZZZ/start')
      .send({ name: 'Asha Rao', email: 'asha@example.com', acceptTerms: true })
      .expect(404);
    await ctx
      .http()
      .post(`/auth/join/${exam.code}/start`)
      .send({ name: 'Asha Rao', email: 'asha2@example.com' })
      .expect(400);
  });

  it('says so when a second code is asked for too soon, instead of staying silent', async () => {
    const exam = await publishExam(ctx, trainer);
    const body = { name: 'Asha Rao', email: 'asha@example.com', acceptTerms: true };
    await ctx.http().post(`/auth/join/${exam.code}/start`).send(body).expect(202);
    const res = await ctx.http().post(`/auth/join/${exam.code}/start`).send(body).expect(429);
    expect(res.body.message).toMatch(/wait \d+ seconds/);
  });

  it('does not let someone rename a verified student without the emailed code', async () => {
    const exam = await publishExam(ctx, trainer);
    await joinWithEmail(exam.code, 'asha@example.com');
    await ctx.prisma.emailOtp.deleteMany({});
    await ctx
      .http()
      .post(`/auth/join/${exam.code}/start`)
      .send({ name: 'Attacker Name', email: 'asha@example.com', acceptTerms: true })
      .expect(202);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'asha@example.com' } });
    expect(user.name).toBe('Asha Rao');
  });
});

describe('NandiVex-run exams', () => {
  /** Publishes (the start must be in the future), then moves the window so the exam is open. */
  async function publishOpen(admin: { accessToken: string }, examId: string) {
    const res = await ctx.http().post(`/exams/${examId}/publish`).set(auth(admin)).expect(200);
    await ctx.prisma.exam.update({
      where: { id: examId },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3 * 3_600_000),
      },
    });
    return res;
  }

  async function nandivexExam(settings: Record<string, unknown> = {}) {
    const admin = await createAdmin(ctx);
    const created = (
      await ctx
        .http()
        .post('/exams')
        .set(auth(admin))
        .send({
          title: 'NandiVex Open Test',
          durationMinutes: 30,
          ...settings,
          startsAt: hours(1),
          endsAt: hours(5),
        })
        .expect(201)
    ).body;
    await ctx
      .http()
      .post(`/exams/${created.id}/questions`)
      .set(auth(admin))
      .send({ type: 'SINGLE', body: 'Q?', options: ['a', 'b'], correctOptions: [0], marks: 2 })
      .expect(201);
    return { admin, created };
  }

  it('is made by an admin with a fee they choose, and published with no creation fee', async () => {
    const { admin, created } = await nandivexExam({ studentFeePaise: 25000 });
    expect(created).toMatchObject({
      nandivexHosted: true,
      studentFeePaise: 25000,
      status: 'DRAFT',
    });
    // the trainer payment route stays trainer-only; admins publish directly
    await ctx.http().post(`/exams/${created.id}/publish-order`).set(auth(admin)).expect(403);
    const published = (await publishOpen(admin, created.id)).body;
    expect(published.code).toMatch(/^NVX-/);
    expect(await ctx.prisma.payment.count({ where: { purpose: 'EXAM_CREATION' } })).toBe(0);
    // trainers cannot use the free publish route, and their exams ignore a custom fee
    const t = (
      await ctx
        .http()
        .post('/exams')
        .set(auth(trainer))
        .send({ title: 'Mine', studentFeePaise: 100 })
        .expect(201)
    ).body;
    expect(t).toMatchObject({ nandivexHosted: false, studentFeePaise: null });
    await ctx.http().post(`/exams/${t.id}/publish`).set(auth(trainer)).expect(403);
  });

  it('charges the student the admin fee and keeps all of it for NandiVex', async () => {
    const { admin, created } = await nandivexExam({ studentFeePaise: 25000 });
    const { code } = (await publishOpen(admin, created.id)).body;
    expect((await ctx.http().get(`/join/${code}`).expect(200)).body).toMatchObject({
      feePaise: 25000,
      nandivexHosted: true,
      trainerName: 'NandiVex Technologies',
    });
    const asha = await joinWithEmail(code, 'asha@example.com');
    const order = (await ctx.http().post(`/join/${code}/order`).set(auth(asha)).expect(200)).body;
    expect(order.amountPaise).toBe(25000);
    await pay(asha, code);
    const entries = await ctx.prisma.ledgerEntry.findMany({ where: { examId: created.id } });
    expect(entries.some((e) => e.account.startsWith('EXAMINER:'))).toBe(false);
    expect(entries.find((e) => e.account === 'PLATFORM')?.amountPaise).toBe(25000);
    expect(entries.reduce((s, e) => s + e.amountPaise, 0)).toBe(0);
  });

  it('can be free: no payment, a confirmation email, and a seat straight away', async () => {
    const { admin, created } = await nandivexExam({ studentFeePaise: 0 });
    const { code } = (await publishOpen(admin, created.id)).body;
    expect((await ctx.http().get(`/join/${code}`).expect(200)).body.feePaise).toBe(0);
    const asha = await joinWithEmail(code, 'asha@example.com');
    await ctx.http().post(`/join/${code}/order`).set(auth(asha)).expect(409);
    const seat = (await ctx.http().post(`/join/${code}/enroll`).set(auth(asha)).expect(200)).body;
    expect(seat.enrollmentId).toBeTruthy();
    // doing it twice does not make a second seat
    expect(
      (await ctx.http().post(`/join/${code}/enroll`).set(auth(asha)).expect(200)).body.enrollmentId,
    ).toBe(seat.enrollmentId);
    expect(ctx.mail.lastTo('asha@example.com')?.subject).toBe(
      'You have joined "NandiVex Open Test"',
    );
    expect(await ctx.prisma.payment.count()).toBe(0);
  });

  it('refuses the free route for a paid exam, and a custom fee on a trainer exam', async () => {
    const exam = await publishExam(ctx, trainer);
    const asha = await joinWithEmail(exam.code, 'asha@example.com');
    await ctx.http().post(`/join/${exam.code}/enroll`).set(auth(asha)).expect(409);
    const draft = (
      await ctx.http().post('/exams').set(auth(trainer)).send({ title: 'Draft exam' }).expect(201)
    ).body;
    await ctx
      .http()
      .patch(`/exams/${draft.id}`)
      .set(auth(trainer))
      .send({ studentFeePaise: 100 })
      .expect(400);
  });
});

describe('practice code after the exam closes', () => {
  async function finishedExam() {
    const exam = await publishExam(ctx, trainer);
    const asha = await joinWithEmail(exam.code, 'asha@example.com');
    const done = await pay(asha, exam.code);
    const attempt = (
      await ctx
        .http()
        .post('/attempts')
        .set(auth(asha))
        .send({ enrollmentId: done.enrollmentId })
        .expect(200)
    ).body;
    await ctx.http().post(`/attempts/${attempt.id}/submit`).set(auth(asha)).expect(200);
    return { exam, asha };
  }

  const close = (examId: string) =>
    ctx.prisma.exam.update({
      where: { id: examId },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });

  it('emails one code per student once the exam has closed, never before', async () => {
    const { exam } = await finishedExam();
    const jobs = ctx.app.get(NotificationsService);
    ctx.mail.clear();
    expect(await jobs.sendPracticeCodes()).toBe(0); // still open
    await close(exam.examId);
    expect(await jobs.sendPracticeCodes()).toBe(1);
    expect(await jobs.sendPracticeCodes()).toBe(0); // only once
    const mail = ctx.mail.lastTo('asha@example.com');
    expect(mail?.subject).toBe('Practice code for "Cloud Fundamentals"');
    expect(mail?.text).toMatch(/PRC-[A-Z0-9]{6}/);
    expect(mail?.text).toMatch(/no payment and no certificate/i);
  });

  it('locks practice sign-in after repeated wrong codes and keeps that session short', async () => {
    const { exam } = await finishedExam();
    await close(exam.examId);
    await ctx.app.get(NotificationsService).sendPracticeCodes();
    const code = ctx.mail.lastTo('asha@example.com')!.text.match(/PRC-[A-Z0-9]{6}/)![0];

    const ok = await ctx.http().post('/auth/practice').send({ code }).expect(200);
    const cookie = String(ok.headers['set-cookie']);
    const token = await ctx.prisma.refreshToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    const hours = (token.expiresAt.getTime() - token.createdAt.getTime()) / 3_600_000;
    expect(cookie).toBeTruthy();
    expect(hours).toBeLessThanOrEqual(12.01);

    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .post('/auth/practice')
        .send({ code: `PRC-BAD00${i}` })
        .expect(400);
    }
    // Now even the right code is refused for a while.
    await ctx.http().post('/auth/practice').send({ code }).expect(429);
  });

  it('opens the practice set with that code, without payment or a certificate', async () => {
    const { exam } = await finishedExam();
    await close(exam.examId);
    await ctx.app.get(NotificationsService).sendPracticeCodes();
    const code = ctx.mail.lastTo('asha@example.com')!.text.match(/PRC-[A-Z0-9]{6}/)![0];

    await ctx.http().post('/auth/practice').send({ code: 'PRC-NOPE00' }).expect(400);
    const session = (
      await ctx.http().post('/auth/practice').send({ code: code.toLowerCase() }).expect(200)
    ).body;
    const set = (await ctx.http().get(`/practice/${exam.examId}`).set(auth(session)).expect(200))
      .body;
    expect(set.questions.length).toBe(3);
    const paymentsBefore = await ctx.prisma.payment.count();
    const certsBefore = await ctx.prisma.certificate.count();
    await ctx
      .http()
      .post(`/practice/${exam.examId}/rounds`)
      .set(auth(session))
      .send({ answers: { [set.questions[0].id]: [0] } })
      .expect(200);
    expect(await ctx.prisma.payment.count()).toBe(paymentsBefore);
    expect(await ctx.prisma.certificate.count()).toBe(certsBefore);
  });

  it('gives nothing to a student who never took the exam', async () => {
    const exam = await publishExam(ctx, trainer);
    await joinWithEmail(exam.code, 'asha@example.com');
    await close(exam.examId);
    ctx.mail.clear();
    expect(await ctx.app.get(NotificationsService).sendPracticeCodes()).toBe(0);
  });
});
