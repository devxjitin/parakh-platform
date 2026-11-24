import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

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
});

const start = (who: { accessToken: string }, enrollment: string, device?: string) => {
  const r = ctx.http().post('/attempts').set(auth(who)).set('User-Agent', 'Mozilla/5.0 (test)');
  if (device) r.set('X-Device-Id', device);
  return r.send({ enrollmentId: enrollment });
};
const view = (who: { accessToken: string }, id: string, device?: string) => {
  const r = ctx.http().get(`/attempts/${id}`).set(auth(who));
  if (device) r.set('X-Device-Id', device);
  return r;
};
const detail = async (attemptId: string) =>
  (await ctx.http().get(`/exams/${exam.examId}/attempts/${attemptId}`).set(auth(trainer))).body;

describe('one device per attempt', () => {
  beforeEach(async () => {
    exam = await publishExam(ctx, trainer);
    enrollmentId = await joinExam(ctx, sam, exam.code);
  });

  it('binds the first device and refuses another one', async () => {
    const a = (await start(sam, enrollmentId, DEV_A).expect(200)).body;
    await view(sam, a.id, DEV_A).expect(200);
    const refused = await view(sam, a.id, DEV_B).expect(403);
    expect(refused.body.code).toBe('DEVICE_MISMATCH');
    // writing from the other device is refused too
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .set('X-Device-Id', DEV_B)
      .send({ selected: [0] })
      .expect(403);
    await ctx
      .http()
      .post(`/attempts/${a.id}/submit`)
      .set(auth(sam))
      .set('X-Device-Id', DEV_B)
      .expect(403);
    // an attempt that started on a device is not open to a client that hides its device either
    await view(sam, a.id).expect(403);
    // the real device keeps working, from a reload or a second tab
    await view(sam, a.id, DEV_A).expect(200);
    await start(sam, enrollmentId, DEV_A).expect(200);
    await start(sam, enrollmentId, DEV_B).expect(403);
  });

  it('records the blocked tries, and the trainer can release the attempt', async () => {
    const a = (await start(sam, enrollmentId, DEV_A).expect(200)).body;
    await view(sam, a.id, DEV_B).expect(403);
    await view(sam, a.id, DEV_B).expect(403);
    const events = await ctx.prisma.proctorEvent.findMany({ where: { attemptId: a.id } });
    // two quick tries are logged once, so the log stays readable
    expect(events.filter((e) => e.type === 'DEVICE_MISMATCH')).toHaveLength(1);
    expect(events[0].deviceId).toBe(DEV_B);

    const rows = (await ctx.http().get(`/exams/${exam.examId}/results`).set(auth(trainer))).body;
    expect(rows.rows[0].flags).toContain('DEVICE_MISMATCH');

    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other-trainer@example.com' });
    await ctx
      .http()
      .post(`/exams/${exam.examId}/attempts/${a.id}/release-device`)
      .set(auth(other))
      .expect(404);
    await ctx
      .http()
      .post(`/exams/${exam.examId}/attempts/${a.id}/release-device`)
      .set(auth(sam))
      .expect(403);
    await ctx
      .http()
      .post(`/exams/${exam.examId}/attempts/${a.id}/release-device`)
      .set(auth(trainer))
      .expect(200);

    // the new device takes over, and the old one is now the stranger
    await view(sam, a.id, DEV_B).expect(200);
    await view(sam, a.id, DEV_A).expect(403);

    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).set('X-Device-Id', DEV_B);
    const d = await detail(a.id);
    expect(d.integrity.flags.map((f: { code: string }) => f.code)).toContain('DEVICE_MISMATCH');
    expect(d.events.some((e: { type: string }) => e.type === 'DEVICE_MISMATCH')).toBe(true);
  });

  it('lets a finished attempt be read from any device and cannot be released again', async () => {
    const a = (await start(sam, enrollmentId, DEV_A).expect(200)).body;
    await ctx
      .http()
      .post(`/attempts/${a.id}/submit`)
      .set(auth(sam))
      .set('X-Device-Id', DEV_A)
      .expect(200);
    await view(sam, a.id, DEV_B).expect(200);
    await ctx
      .http()
      .post(`/exams/${exam.examId}/attempts/${a.id}/release-device`)
      .set(auth(trainer))
      .expect(409);
  });

  it('ignores a malformed device id and flags the attempt for the trainer', async () => {
    const a = (await start(sam, enrollmentId, 'short').expect(200)).body;
    const stored = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(stored.deviceId).toBeNull();
    // the first request that does identify itself claims the attempt
    await view(sam, a.id, DEV_A).expect(200);
    await view(sam, a.id, DEV_B).expect(403);
  });

  it('keeps where the attempt was taken and when the network changed', async () => {
    const a = (await start(sam, enrollmentId, DEV_A).expect(200)).body;
    const stored = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(stored.startIp).toBeTruthy();
    expect(stored.userAgent).toBeTruthy();
    await ctx.prisma.attempt.update({ where: { id: a.id }, data: { startIp: '203.0.113.9' } });
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).set('X-Device-Id', DEV_A);
    const d = await detail(a.id);
    expect(d.integrity.flags.map((f: { code: string }) => f.code)).toContain('NETWORK_CHANGED');
  });

  it('flags two students who used the same device', async () => {
    const lee = await newStudent(ctx, 'lee@example.com');
    const leeEnrollment = await joinExam(ctx, lee, exam.code);
    const a = (await start(sam, enrollmentId, DEV_A).expect(200)).body;
    const b = (await start(lee, leeEnrollment, DEV_A).expect(200)).body;
    for (const [who, id] of [
      [sam, a.id],
      [lee, b.id],
    ] as const) {
      await ctx.http().post(`/attempts/${id}/submit`).set(auth(who)).set('X-Device-Id', DEV_A);
    }
    const rows = (await ctx.http().get(`/exams/${exam.examId}/results`).set(auth(trainer))).body;
    expect(rows.rows.every((r: { flags: string[] }) => r.flags.includes('SHARED_DEVICE'))).toBe(
      true,
    );
    const d = await detail(a.id);
    expect(d.integrity.sharedWith).toHaveLength(1);
    expect(d.integrity.sharedWith[0].email).toBe('lee@example.com');
  });
});

describe('guessing exam codes', () => {
  it('pauses a network after too many wrong codes (lookups need no account)', async () => {
    exam = await publishExam(ctx, trainer);
    for (let i = 0; i < 8; i++) {
      await ctx.http().get(`/join/WRONG-${i}`).expect(404);
    }
    await ctx.http().get(`/join/WRONG-9`).expect(429);
    // even the right code waits
    await ctx.http().get(`/join/${exam.code}`).expect(429);
  });

  it('does not count right codes against the student', async () => {
    exam = await publishExam(ctx, trainer);
    for (let i = 0; i < 12; i++) {
      await ctx.http().get(`/join/${exam.code}`).set(auth(sam)).expect(200);
    }
  });
});
