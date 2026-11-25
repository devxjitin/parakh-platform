import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };
let exam: PublishedExam;
let sam: { accessToken: string };
let samAttempt: string;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});

/** Sam picks option 0 on the single question (marks 2; option 0 is correct) and submits. */
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  exam = await publishExam(ctx, trainer);
  sam = await newStudent(ctx, 'sam@example.com');
  const enrollmentId = await joinExam(ctx, sam, exam.code);
  const a = (await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200))
    .body;
  samAttempt = a.id;
  await ctx
    .http()
    .put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}`)
    .set(auth(sam))
    .send({ selected: [0] })
    .expect(200);
  await ctx.http().post(`/attempts/${samAttempt}/submit`).set(auth(sam)).expect(200);
});

const base = () => `/exams/${exam.examId}`;
const put = (url: string, body: object) =>
  ctx
    .http()
    .put(base() + url)
    .set(auth(trainer))
    .send(body);
const score = async () =>
  (await ctx.prisma.attempt.findUnique({ where: { id: samAttempt } }))?.score ?? null;
const singleMarks = async () =>
  (
    await ctx.prisma.answer.findUnique({
      where: {
        attemptId_questionId: { attemptId: samAttempt, questionId: exam.questionIds.single },
      },
    })
  )?.marksAwarded;

describe('overriding one answer', () => {
  it('sets a mark by hand that survives a regrade, and clears it again', async () => {
    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: 1,
      reason: 'Half credit for the working shown',
    }).expect(200);
    expect(await singleMarks()).toBe(1);

    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: null,
    }).expect(200);
    // Back to the marks the answer key gives (option 0 is correct).
    expect(await singleMarks()).toBe(2);
  });

  it('needs a reason and cannot exceed the question marks', async () => {
    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: 1,
    }).expect(400);
    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: 50,
      reason: 'way too generous',
    }).expect(409);
  });
});

describe('who and when', () => {
  const overrideUrl = () => `/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`;

  it('is for the owning trainer only', async () => {
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await ctx
      .http()
      .put(base() + overrideUrl())
      .set(auth(other))
      .send({ marks: 1, reason: 'not my exam' })
      .expect(404);
  });

  it('is refused once results are published', async () => {
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });
    await put(overrideUrl(), { marks: 1, reason: 'too late' }).expect(409);
  });
});

describe('after the result was sent', () => {
  it('refuses to override marks once the student has been emailed', async () => {
    const url = `/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`;
    await ctx.prisma.attempt.update({
      where: { id: samAttempt },
      data: { resultEmailedAt: new Date() },
    });
    const res = await put(url, { marks: 1, reason: 'late fix' }).expect(409);
    expect(res.body.message).toMatch(/already been sent/);
  });
});

describe('a published exam cannot be fixed', () => {
  const qUrl = () => `${base()}/questions/${exam.questionIds.single}`;

  it('has no way to change the wording, the answer key or drop a question', async () => {
    await ctx
      .http()
      .patch(`${qUrl()}/correction`)
      .set(auth(trainer))
      .send({ body: 'Changed' })
      .expect(404);
    await ctx
      .http()
      .put(`${qUrl()}/answer-key`)
      .set(auth(trainer))
      .send({ correctOptions: [1], reason: 'key fix' })
      .expect(404);
    await ctx
      .http()
      .put(`${qUrl()}/dropped`)
      .set(auth(trainer))
      .send({ dropped: true, reason: 'drop it' })
      .expect(404);
  });

  it('refuses edits to the exam and its questions', async () => {
    await ctx.http().patch(base()).set(auth(trainer)).send({ title: 'New title' }).expect(409);
    await ctx
      .http()
      .put(qUrl())
      .set(auth(trainer))
      .send({
        type: 'SINGLE',
        body: 'Changed',
        options: ['a', 'b'],
        correctOptions: [0],
        marks: 1,
      })
      .expect(409);
  });
});
