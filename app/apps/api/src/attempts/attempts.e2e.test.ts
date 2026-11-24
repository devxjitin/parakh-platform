import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };
let sam: { accessToken: string };
let exam: PublishedExam;
let enrollmentId: string;

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

const start = (who = sam, id = enrollmentId) =>
  ctx.http().post('/attempts').set(auth(who)).send({ enrollmentId: id });

async function begin() {
  return (await start().expect(200)).body as {
    id: string;
    questions: {
      id: string;
      number: number;
      type: string;
      options: { id: number; text: string }[];
    }[];
    deadlineAt: string;
    answers: Record<string, unknown>;
  };
}

describe('starting', () => {
  it('only for the enrolled student', async () => {
    const other = await newStudent(ctx, 'other@example.com');
    await start(other).expect(404);
    await ctx.http().post('/attempts').expect(401);
    await ctx.http().post('/attempts').set(auth(trainer)).send({ enrollmentId }).expect(403);
  });

  it('refuses before the exam opens and after it closes', async () => {
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { startsAt: new Date(Date.now() + 3_600_000) },
    });
    await start().expect(409);
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { startsAt: new Date(Date.now() - 7_200_000), endsAt: new Date(Date.now() - 1000) },
    });
    await start().expect(409);
  });

  it('never sends answers, explanations or rubrics', async () => {
    const a = await begin();
    const raw = JSON.stringify(a);
    expect(raw).not.toContain('correctOptions');
    expect(raw).not.toContain('SECRET EXPLANATION');
    expect(raw).not.toContain('SECRET RUBRIC');
    expect(a.questions).toHaveLength(3);
    expect(a.questions.map((q) => q.number)).toEqual([1, 2, 3]);
  });

  it('does not expose the former code execution endpoint', async () => {
    const attempt = await begin();
    await ctx
      .http()
      .post(`/attempts/${attempt.id}/questions/${exam.questionIds.subjective}/run`)
      .set(auth(sam))
      .send({ language: 'python', source: 'print(1)' })
      .expect(404);
  });

  it('fixes the deadline on the server and returns the same attempt on a second start', async () => {
    const a = await begin();
    const minutes = (new Date(a.deadlineAt).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);
    const b = await begin();
    expect(b.id).toBe(a.id);
    expect(b.deadlineAt).toBe(a.deadlineAt);
    expect(await ctx.prisma.attempt.count()).toBe(1);
  });

  it('caps the deadline at the closing time', async () => {
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() + 10 * 60_000) },
    });
    const a = await begin();
    const minutes = (new Date(a.deadlineAt).getTime() - Date.now()) / 60000;
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it("keeps the trainer's order when shuffling is off, and shuffles when it is on", async () => {
    await ctx.reset();
    trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
    sam = await newStudent(ctx, 'sam@example.com');
    const fixed = await publishExam(ctx, trainer, {
      shuffleQuestions: false,
      shuffleOptions: false,
    });
    const id = await joinExam(ctx, sam, fixed.code);
    const a = (await start(sam, id).expect(200)).body;
    expect(a.questions.map((q: { id: string }) => q.id)).toEqual([
      fixed.questionIds.single,
      fixed.questionIds.multi,
      fixed.questionIds.subjective,
    ]);
    expect(a.questions[0].options.map((o: { id: number }) => o.id)).toEqual([0, 1, 2, 3]);

    // With shuffling on, every student still gets each option exactly once.
    const mixed = await publishExam(ctx, trainer);
    for (let i = 0; i < 4; i++) {
      const s = await newStudent(ctx, `s${i}@example.com`);
      const e = await joinExam(ctx, s, mixed.code);
      const r = (await start(s, e).expect(200)).body;
      const single = r.questions.find((q: { id: string }) => q.id === mixed.questionIds.single);
      expect(single.options.map((o: { id: number }) => o.id).sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe('answering', () => {
  const put = (attemptId: string, qid: string, body: object, who = sam) =>
    ctx.http().put(`/attempts/${attemptId}/answers/${qid}`).set(auth(who)).send(body);

  it('autosaves choices, text and flags, and returns them on reload', async () => {
    const a = await begin();
    await put(a.id, exam.questionIds.single, { selected: [2] }).expect(200);
    await put(a.id, exam.questionIds.multi, { selected: [1, 0, 1] }).expect(200);
    await put(a.id, exam.questionIds.subjective, {
      text: 'You secure the cloud, they secure the hardware.',
    }).expect(200);
    await put(a.id, exam.questionIds.single, { flagged: true }).expect(200); // flag only: keeps the choice

    const reloaded = (await ctx.http().get(`/attempts/${a.id}`).set(auth(sam)).expect(200)).body;
    expect(reloaded.answers[exam.questionIds.single]).toEqual({
      selected: [2],
      text: '',
      flagged: true,
    });
    expect(reloaded.answers[exam.questionIds.multi].selected).toEqual([0, 1]);
    expect(reloaded.answers[exam.questionIds.subjective].text).toContain(
      'shared'.slice(0, 0) + 'secure the cloud',
    );
  });

  it('ignores a late older save and accepts newer ones', async () => {
    const a = await begin();
    const q = exam.questionIds.single;
    await put(a.id, q, { selected: [1], seq: 20 }).expect(200);
    await put(a.id, q, { selected: [3], seq: 10 }).expect(200); // older, arrives late
    let r = (await ctx.http().get(`/attempts/${a.id}`).set(auth(sam)).expect(200)).body;
    expect(r.answers[q].selected).toEqual([1]);
    await put(a.id, q, { selected: [2], seq: 30 }).expect(200);
    r = (await ctx.http().get(`/attempts/${a.id}`).set(auth(sam)).expect(200)).body;
    expect(r.answers[q].selected).toEqual([2]);
  });

  it('records a batch of queued proctor events', async () => {
    const a = await begin();
    const res = await ctx
      .http()
      .post(`/attempts/${a.id}/events/batch`)
      .set(auth(sam))
      .send({ events: [{ type: 'COPY' }, { type: 'PASTE' }] })
      .expect(200);
    expect(res.body.ended).toBeFalsy();
    expect(await ctx.prisma.proctorEvent.count({ where: { attemptId: a.id } })).toBe(2);
    await ctx
      .http()
      .post(`/attempts/${a.id}/events/batch`)
      .set(auth(sam))
      .send({ events: [] })
      .expect(400);
  });

  it('rejects impossible answers', async () => {
    const a = await begin();
    await put(a.id, exam.questionIds.single, { selected: [0, 1] }).expect(409);
    await put(a.id, exam.questionIds.single, { selected: [9] }).expect(400);
    await put(a.id, exam.questionIds.multi, { selected: [3] }).expect(409);
    await put(a.id, exam.questionIds.single, {}).expect(400);
    await put(a.id, '00000000-0000-4000-8000-000000000000', { selected: [0] }).expect(404);
  });

  it("keeps one student's attempt private from another", async () => {
    const a = await begin();
    const other = await newStudent(ctx, 'other@example.com');
    await ctx.http().get(`/attempts/${a.id}`).set(auth(other)).expect(404);
    await put(a.id, exam.questionIds.single, { selected: [0] }, other).expect(404);
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(other)).expect(404);
  });
});

describe('finishing', () => {
  it('submits once, then locks everything and hides the questions', async () => {
    const a = await begin();
    const done = await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    expect(done.body).toMatchObject({
      status: 'GRADED',
      endReason: 'SUBMITTED_BY_STUDENT',
      questions: [],
    });
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [0] })
      .expect(409);
    // Submitting again is harmless.
    await ctx.http().post(`/attempts/${a.id}/submit`).set(auth(sam)).expect(200);
    // And the student cannot start a fresh attempt.
    const again = (await start().expect(200)).body;
    expect(again.id).toBe(a.id);
    expect(again.status).toBe('GRADED');
    const list = (await ctx.http().get('/me/enrollments').set(auth(sam)).expect(200)).body;
    expect(list[0].canStart).toBe(false);
  });

  it('accepts a save just after the deadline (grace) but not long after', async () => {
    const a = await begin();
    await ctx.prisma.attempt.update({
      where: { id: a.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [1] })
      .expect(200);

    await ctx.prisma.attempt.update({
      where: { id: a.id },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [2] })
      .expect(409);
    const row = await ctx.prisma.attempt.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'GRADED', endReason: 'TIME_UP' });
    const saved = await ctx.prisma.answer.findFirst({ where: { attemptId: a.id } });
    expect(saved?.selected).toEqual([1]); // the late write did not land
  });

  it('auto-submits an overdue attempt when it is next opened', async () => {
    const a = await begin();
    await ctx.prisma.attempt.update({
      where: { id: a.id },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });
    const view = (await ctx.http().get(`/attempts/${a.id}`).set(auth(sam)).expect(200)).body;
    expect(view).toMatchObject({ status: 'GRADED', endReason: 'TIME_UP', questions: [] });
  });
});

describe('proctoring', () => {
  const event = (attemptId: string, type: string) =>
    ctx.http().post(`/attempts/${attemptId}/events`).set(auth(sam)).send({ type });
  const ageEvents = async () => {
    const past = new Date(Date.now() - 10_000);
    await ctx.prisma.proctorEvent.updateMany({ data: { createdAt: past } });
    await ctx.prisma.attempt.updateMany({
      where: { lastStrikeAt: { not: null } },
      data: { lastStrikeAt: past },
    });
  };

  it('counts a strike, merges events that fire together, and only logs copy/paste', async () => {
    const a = await begin();
    expect((await event(a.id, 'TAB_HIDDEN').expect(200)).body).toMatchObject({
      strikes: 1,
      ended: false,
    });
    expect((await event(a.id, 'WINDOW_BLUR').expect(200)).body.strikes).toBe(1); // same moment
    await ageEvents();
    expect((await event(a.id, 'COPY').expect(200)).body.strikes).toBe(1);
    expect((await event(a.id, 'CONTEXT_MENU').expect(200)).body.strikes).toBe(1);
    expect((await event(a.id, 'FULLSCREEN_EXIT').expect(200)).body.strikes).toBe(2);
    expect(await ctx.prisma.proctorEvent.count({ where: { attemptId: a.id } })).toBe(5);
  });

  it('auto-submits on the third strike and then refuses writes', async () => {
    const a = await begin();
    for (let i = 1; i <= 2; i++) {
      await event(a.id, 'TAB_HIDDEN').expect(200);
      await ageEvents();
    }
    const last = (await event(a.id, 'FULLSCREEN_EXIT').expect(200)).body;
    expect(last).toMatchObject({ strikes: 3, ended: true, status: 'AUTO_SUBMITTED' });
    const row = await ctx.prisma.attempt.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'GRADED', endReason: 'STRIKES' });
    await ctx
      .http()
      .put(`/attempts/${a.id}/answers/${exam.questionIds.single}`)
      .set(auth(sam))
      .send({ selected: [0] })
      .expect(409);
    // Events after the end change nothing.
    expect((await event(a.id, 'TAB_HIDDEN').expect(200)).body.ended).toBe(true);
  });

  /** A fresh exam with its own strike policy, joined and started by Sam. */
  async function withPolicy(settings: object) {
    const e = await publishExam(ctx, trainer, settings);
    const enr = await joinExam(ctx, sam, e.code);
    const a = (await start(sam, enr).expect(200)).body as { id: string };
    return a.id;
  }

  it('counts concurrent events as one strike', async () => {
    const a = await begin();
    await Promise.all([
      event(a.id, 'TAB_HIDDEN'),
      event(a.id, 'WINDOW_BLUR'),
      event(a.id, 'FULLSCREEN_EXIT'),
    ]);
    const row = await ctx.prisma.attempt.findUnique({ where: { id: a.id } });
    expect(row?.strikes).toBe(1);
  });

  it('does not count a browser without full screen as a strike', async () => {
    const a = await begin();
    expect((await event(a.id, 'FULLSCREEN_UNSUPPORTED').expect(200)).body.strikes).toBe(0);
  });

  it('AUTO_SUBMIT honours the exam limit', async () => {
    const id = await withPolicy({ strikePolicy: 'AUTO_SUBMIT', maxStrikes: 2 });
    await event(id, 'TAB_HIDDEN').expect(200);
    await ageEvents();
    const last = (await event(id, 'TAB_HIDDEN').expect(200)).body;
    expect(last).toMatchObject({ strikes: 2, ended: true, status: 'AUTO_SUBMITTED' });
  });

  it('WARN counts strikes but never submits', async () => {
    const id = await withPolicy({ strikePolicy: 'WARN', maxStrikes: 1 });
    for (let i = 0; i < 4; i++) {
      await event(id, 'TAB_HIDDEN').expect(200);
      await ageEvents();
    }
    const row = await ctx.prisma.attempt.findUnique({ where: { id } });
    expect(row).toMatchObject({ strikes: 4, status: 'IN_PROGRESS' });
  });

  it('OFF only records the events', async () => {
    const id = await withPolicy({ strikePolicy: 'OFF' });
    for (let i = 0; i < 3; i++) {
      await event(id, 'TAB_HIDDEN').expect(200);
      await ageEvents();
    }
    const row = await ctx.prisma.attempt.findUnique({ where: { id } });
    expect(row).toMatchObject({ strikes: 0, status: 'IN_PROGRESS' });
    expect(await ctx.prisma.proctorEvent.count({ where: { attemptId: id } })).toBe(3);
  });

  it('shows the policy to the student and validates the limit', async () => {
    const id = await withPolicy({ strikePolicy: 'WARN', maxStrikes: 5 });
    const view = (await ctx.http().get(`/attempts/${id}`).set(auth(sam)).expect(200)).body;
    expect(view).toMatchObject({ strikePolicy: 'WARN', maxStrikes: 5 });
    await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Bad limit', maxStrikes: 11 })
      .expect(400);
  });

  it('rejects unknown event types', async () => {
    const a = await begin();
    await event(a.id, 'SOMETHING_ELSE').expect(400);
  });
});
