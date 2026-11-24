import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';
import { GRACE_MS } from '../common/timing';
import { GradingService } from './grading.service';

let ctx: TestContext;
let trainer: { accessToken: string };
let sam: { accessToken: string };
let exam: PublishedExam;
let enrollmentId: string;

const DEV_A = 'device-aaaaaaaaaaaaaaaa';
const DEV_B = 'device-bbbbbbbbbbbbbbbb';

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  sam = await newStudent(ctx, 'sam@example.com');
  exam = await publishExam(ctx, trainer);
  enrollmentId = await joinExam(ctx, sam, exam.code);
});

const base = () => `/exams/${exam.examId}`;
const trainerPost = (url: string, body: object) =>
  ctx
    .http()
    .post(base() + url)
    .set(auth(trainer))
    .send(body);
const startAttempt = (device?: string) => {
  const r = ctx.http().post('/attempts').set(auth(sam));
  if (device) r.set('X-Device-Id', device);
  return r.send({ enrollmentId });
};
const view = (id: string, device?: string) => {
  const r = ctx.http().get(`/attempts/${id}`).set(auth(sam));
  if (device) r.set('X-Device-Id', device);
  return r;
};
const minutesLeft = (a: { deadlineAt: string; serverTime: string }) =>
  (new Date(a.deadlineAt).getTime() - new Date(a.serverTime).getTime()) / 60_000;

describe('extra minutes before the start', () => {
  it('lengthens the attempt, and cannot be set once the student started', async () => {
    await ctx
      .http()
      .put(`${base()}/enrollments/${enrollmentId}/extra-minutes`)
      .set(auth(trainer))
      .send({ minutes: 30 })
      .expect(200);
    const a = (await startAttempt().expect(200)).body;
    expect(minutesLeft(a)).toBeGreaterThan(88); // 60 + 30
    expect(minutesLeft(a)).toBeLessThan(91);
    await ctx
      .http()
      .put(`${base()}/enrollments/${enrollmentId}/extra-minutes`)
      .set(auth(trainer))
      .send({ minutes: 45 })
      .expect(409);
  });

  it('is only for the owning trainer', async () => {
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await ctx
      .http()
      .put(`${base()}/enrollments/${enrollmentId}/extra-minutes`)
      .set(auth(other))
      .send({ minutes: 30 })
      .expect(404);
  });
});

describe('roster', () => {
  it('lists enrolled students with their extra time, for the owning trainer only', async () => {
    const res = await ctx.http().get(`${base()}/roster`).set(auth(trainer)).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ enrollmentId, extraMinutes: 0, started: false }),
    ]);
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await ctx.http().get(`${base()}/roster`).set(auth(other)).expect(404);
  });
});

describe('adding time to a running attempt', () => {
  it('moves the deadline later, needs a reason, and is audited', async () => {
    const a = (await startAttempt().expect(200)).body;
    await trainerPost(`/attempts/${a.id}/add-time`, { minutes: 15 }).expect(400);
    await trainerPost(`/attempts/${a.id}/add-time`, {
      minutes: 15,
      reason: 'Internet dropped for ten minutes',
    }).expect(200);
    const after = (await view(a.id).expect(200)).body;
    expect(minutesLeft(after)).toBeGreaterThan(73);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'attempt.add_time' } })).toBe(1);
  });

  it('refuses once the attempt has ended', async () => {
    const a = (await startAttempt().expect(200)).body;
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    await trainerPost(`/attempts/${a.id}/add-time`, { minutes: 15, reason: 'too late now' }).expect(
      409,
    );
  });

  it('keeps a stale timer or sweeper from ending an extended attempt', async () => {
    const { id } = (await startAttempt(DEV_A).expect(200)).body;
    const originalDeadline = new Date(Date.now() + 10_000);
    await ctx.prisma.attempt.update({ where: { id }, data: { deadlineAt: originalDeadline } });
    const { deadlineAt } = (
      await trainerPost(`/attempts/${id}/add-time`, {
        minutes: 10,
        reason: 'Lost connection during the attempt',
      }).expect(200)
    ).body;

    const timing = () =>
      ctx.http().get(`/attempts/${id}/timing`).set(auth(sam)).set('X-Device-Id', DEV_A);
    const grading = ctx.app.get(GradingService);
    try {
      vi.setSystemTime(originalDeadline.getTime() + GRACE_MS + 1);
      expect(await grading.settleExpired({ id, deadlineAt: originalDeadline })).toBe(false);
      const live = await timing().expect(200).expect('Cache-Control', 'private, no-store');
      expect(live.body).toEqual({
        deadlineAt,
        status: 'IN_PROGRESS',
        endReason: null,
        serverTime: expect.any(String),
      });

      vi.setSystemTime(Date.parse(deadlineAt) + GRACE_MS + 1);
      const ended = await timing().expect(200);
      expect(ended.body).toMatchObject({ status: 'GRADED', endReason: 'TIME_UP' });
      const stored = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id } });
      expect(stored.submittedAt?.toISOString()).toBe(deadlineAt);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reopening a submitted attempt', () => {
  it('puts it back in progress with a fresh deadline and keeps the answers', async () => {
    const a = (await startAttempt().expect(200)).body;
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [0] })
      .expect(200);
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    await ctx.prisma.attempt.update({ where: { id: a.id }, data: { strikes: 2 } });

    await trainerPost(`/attempts/${a.id}/reopen`, {
      minutes: 30,
      reason: 'Power cut at 10:42',
      resetStrikes: true,
    }).expect(200);

    const again = (await view(a.id).expect(200)).body;
    expect(again.status).toBe('IN_PROGRESS');
    expect(again.strikes).toBe(0);
    expect(minutesLeft(again)).toBeGreaterThan(28);
    expect(again.answers[exam.questionIds.single].selected).toEqual([0]);
    // the student can keep working and submit again
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [1] })
      .expect(200);
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    const row = await ctx.prisma.attempt.findUnique({ where: { id: a.id } });
    expect(row?.score).toBe(0); // option B is wrong
  });

  it('shows the history on the marking screen', async () => {
    const a = (await startAttempt().expect(200)).body;
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    await trainerPost(`/attempts/${a.id}/reopen`, {
      minutes: 20,
      reason: 'Phone call strikes',
    }).expect(200);
    // still running, so the marking screen is closed to it until the student submits again
    await ctx.http().get(`${base()}/attempts/${a.id}`).set(auth(trainer)).expect(409);
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    const after = (
      await ctx.http().get(`${base()}/attempts/${a.id}`).set(auth(trainer)).expect(200)
    ).body;
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({
      action: 'REOPEN',
      reason: 'Phone call strikes',
      minutes: 20,
    });
  });

  it('refuses a running attempt and results that are published', async () => {
    const a = (await startAttempt().expect(200)).body;
    await trainerPost(`/attempts/${a.id}/reopen`, { minutes: 20, reason: 'still running' }).expect(
      409,
    );
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    await ctx.prisma.attempt.update({ where: { id: a.id }, data: { status: 'RESULT_PUBLISHED' } });
    await trainerPost(`/attempts/${a.id}/reopen`, { minutes: 20, reason: 'too late' }).expect(409);
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });
    await trainerPost(`/attempts/${a.id}/reopen`, { minutes: 20, reason: 'too late' }).expect(409);
  });
});

describe('automatic device release', () => {
  it('hands the attempt to a new device once the old one has been silent for 5 minutes', async () => {
    const a = (await startAttempt(DEV_A).expect(200)).body;
    await view(a.id, DEV_B).expect(403); // the old device is still fresh
    await ctx.prisma.attempt.update({
      where: { id: a.id },
      data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
    });
    await view(a.id, DEV_B).expect(200);
    await view(a.id, DEV_A).expect(403); // and now the old one is the stranger

    const events = await ctx.prisma.proctorEvent.findMany({ where: { attemptId: a.id } });
    expect(events.some((e) => e.type === 'DEVICE_AUTO_RELEASED')).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'attempt.device.auto_release' } }),
    ).toBe(1);
  });
});
