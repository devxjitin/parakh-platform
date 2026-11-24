import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };
let sam: { accessToken: string };
let exam: PublishedExam;
let attemptId: string;

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
  const enrollmentId = await joinExam(ctx, sam, exam.code);
  attemptId = (await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200))
    .body.id;
});

const submitExam = () =>
  ctx.http().post(`/attempts/${attemptId}/submit`).set(auth(sam)).expect(200);
/** The exam window ends. */
const closeExam = () =>
  ctx.prisma.exam.update({
    where: { id: exam.examId },
    data: { endsAt: new Date(Date.now() - 60_000) },
  });
const set = (who = sam) => ctx.http().get(`/practice/${exam.examId}`).set(auth(who));
const check = (q: string, body: object, who = sam) =>
  ctx.http().post(`/practice/${exam.examId}/questions/${q}/check`).set(auth(who)).send(body);
const round = (answers: object, who = sam) =>
  ctx.http().post(`/practice/${exam.examId}/rounds`).set(auth(who)).send({ answers });

describe('who can open a practice set', () => {
  it('refuses while the exam is still open, even for someone who submitted', async () => {
    await submitExam();
    const res = await set().expect(403);
    expect(res.body.message).toMatch(/after the exam has closed/i);
    await ctx.http().get('/practice').set(auth(sam)).expect(200).expect([]);
  });

  it('refuses a student who never took the exam', async () => {
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, lena, exam.code); // paid, never started
    await closeExam();
    const res = await set(lena).expect(403);
    expect(res.body.message).toMatch(/only for students who took/i);
    await ctx.http().get('/practice').set(auth(lena)).expect(200).expect([]);
  });

  it('refuses a student who is not enrolled at all, and trainers', async () => {
    const stranger = await newStudent(ctx, 'stranger@example.com');
    await closeExam();
    await set(stranger).expect(403);
    await set(trainer).expect(403);
    await ctx.http().get(`/practice/not-an-id`).set(auth(sam)).expect(404);
  });

  it('opens once the exam has closed and the student submitted', async () => {
    await submitExam();
    await closeExam();
    const res = await set().expect(200);
    expect(res.body.title).toBe('Cloud Fundamentals');
    expect(res.body.questions).toHaveLength(3);
    const list = (await ctx.http().get('/practice').set(auth(sam)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ examId: exam.examId, questionCount: 3, scoredCount: 2 });
  });

  it('counts a student who closed the tab once their time ran out', async () => {
    await ctx.prisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt: new Date(Date.now() - 3_600_000) },
    });
    await closeExam();
    await set().expect(200);
  });

  it('opens for everyone who took it once results are final', async () => {
    await submitExam();
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });
    await set().expect(200);
  });
});

describe('expiry', () => {
  const closedDaysAgo = (days: number) =>
    ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() - days * 86_400_000) },
    });

  beforeEach(async () => {
    await submitExam();
  });

  it('stays open for 90 days after the exam closes, and says until when', async () => {
    await closedDaysAgo(89);
    const res = await set().expect(200);
    const left = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(86_400_000);
    const list = (await ctx.http().get('/practice').set(auth(sam)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].expiresAt).toBe(res.body.expiresAt);
  });

  it('closes after 90 days: not listed, not openable, no checks or rounds', async () => {
    await closedDaysAgo(91);
    const res = await set().expect(403);
    expect(res.body.message).toMatch(/expired/i);
    await check(exam.questionIds.single, { selected: [0] }).expect(403);
    await round({}).expect(403);
    await ctx.http().get('/practice').set(auth(sam)).expect(200).expect([]);
  });

  it('counts from when results came out if the exam has no end time', async () => {
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: {
        endsAt: null,
        status: 'RESULTS_FINAL',
        resultsPublishedAt: new Date(Date.now() - 91 * 86_400_000),
      },
    });
    await set().expect(403);
  });
});

describe('what the set shows', () => {
  beforeEach(async () => {
    await submitExam();
    await closeExam();
  });

  it('shows questions without the answers', async () => {
    const res = await set().expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('SECRET EXPLANATION');
    expect(text).not.toContain('SECRET RUBRIC');
    expect(text).not.toContain('correctOptions');
  });
});

describe('instant feedback', () => {
  beforeEach(async () => {
    await submitExam();
    await closeExam();
  });

  it('marks a single choice and shows the answer and explanation', async () => {
    const right = (await check(exam.questionIds.single, { selected: [0] }).expect(200)).body;
    expect(right).toMatchObject({
      correct: true,
      marks: 2,
      correctOptions: [0],
      explanation: 'SECRET EXPLANATION',
    });
    const wrong = (await check(exam.questionIds.single, { selected: [2] }).expect(200)).body;
    expect(wrong).toMatchObject({ correct: false, correctOptions: [0] });
  });

  it('marks multiple choice, and treats no answer as not correct', async () => {
    expect(
      (await check(exam.questionIds.multi, { selected: [0, 1] }).expect(200)).body.correct,
    ).toBe(true);
    expect((await check(exam.questionIds.multi, { selected: [0] }).expect(200)).body.correct).toBe(
      false,
    );
    expect((await check(exam.questionIds.multi, {}).expect(200)).body.correct).toBe(false);
  });

  it('gives guidance, not a mark, for written answers', async () => {
    const res = (await check(exam.questionIds.subjective, { text: 'anything' }).expect(200)).body;
    expect(res).toMatchObject({ correct: null, marks: null, guidance: 'SECRET RUBRIC' });
  });

  it('refuses a question from another exam', async () => {
    await check('00000000-0000-4000-8000-000000000000', { selected: [0] }).expect(404);
  });
});

describe('practice rounds', () => {
  beforeEach(async () => {
    await submitExam();
    await closeExam();
  });

  it('scores the choice questions and keeps a history', async () => {
    const q = exam.questionIds;
    const first = (await round({ [q.single]: [0], [q.multi]: [0, 1] }).expect(200)).body;
    expect(first).toMatchObject({
      score: 5,
      maxScore: 5,
      percent: 100,
      answered: 2,
      scoredCount: 2,
    });
    const second = (await round({ [q.single]: [1] }).expect(200)).body;
    expect(second).toMatchObject({ score: 0, percent: 0, answered: 1 });

    const history = (
      await ctx.http().get(`/practice/${exam.examId}/rounds`).set(auth(sam)).expect(200)
    ).body;
    expect(history).toHaveLength(2);
    const list = (await ctx.http().get('/practice').set(auth(sam)).expect(200)).body;
    expect(list[0]).toMatchObject({ rounds: 2, bestPercent: 100 });
  });

  it('never changes the official score', async () => {
    const before = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    await round({ [exam.questionIds.single]: [0] }).expect(200);
    const after = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(after.score).toBe(before.score);
    expect(after.status).toBe(before.status);
    expect(await ctx.prisma.answer.count({ where: { attemptId } })).toBe(0);
  });

  it("keeps each student's rounds private", async () => {
    await round({ [exam.questionIds.single]: [0] }).expect(200);
    // Ben also took the exam (before it closed) but has not practised.
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() + 3_600_000) },
    });
    const ben = await newStudent(ctx, 'ben@example.com');
    const enrollmentId = await joinExam(ctx, ben, exam.code);
    const benAttempt = (
      await ctx.http().post('/attempts').set(auth(ben)).send({ enrollmentId }).expect(200)
    ).body.id;
    await ctx.http().post(`/attempts/${benAttempt}/submit`).set(auth(ben)).expect(200);
    await closeExam();
    const history = (
      await ctx.http().get(`/practice/${exam.examId}/rounds`).set(auth(ben)).expect(200)
    ).body;
    expect(history).toEqual([]);
  });

  it('validates the payload', async () => {
    await ctx
      .http()
      .post(`/practice/${exam.examId}/rounds`)
      .set(auth(sam))
      .send({ answers: { 'not-a-uuid': [0] } })
      .expect(400);
  });
});
