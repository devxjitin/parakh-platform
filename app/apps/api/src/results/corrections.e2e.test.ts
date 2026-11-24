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

describe('fixing the answer key', () => {
  it('marks every finished attempt again with the new key, and audits before and after', async () => {
    expect(await singleMarks()).toBe(2);
    const res = await put(`/questions/${exam.questionIds.single}/answer-key`, {
      correctOptions: [1],
      reason: 'Option B was the right one',
    }).expect(200);
    expect(res.body.regraded).toBe(1);
    expect(await singleMarks()).toBe(0);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'question.correct_key' },
    });
    expect(JSON.stringify(audit?.meta)).toContain('Option B was the right one');
    const q = await ctx.prisma.question.findUnique({ where: { id: exam.questionIds.single } });
    expect(q?.revision).toBe(1);
  });

  it('rejects impossible keys and written questions', async () => {
    await put(`/questions/${exam.questionIds.single}/answer-key`, {
      correctOptions: [0, 1],
      reason: 'two answers',
    }).expect(409);
    await put(`/questions/${exam.questionIds.single}/answer-key`, {
      correctOptions: [5],
      reason: 'no such option',
    }).expect(409);
    await put(`/questions/${exam.questionIds.subjective}/answer-key`, {
      correctOptions: [0],
      reason: 'written question',
    }).expect(409);
  });
});

describe('dropping a question', () => {
  it('gives everyone its full marks, and can be undone', async () => {
    expect(await score()).toBe(2); // only the single question was answered, correctly
    // Sam left the multi question blank, so it was worth 0 to him.
    await put(`/questions/${exam.questionIds.multi}/dropped`, {
      dropped: true,
      reason: 'Question was ambiguous',
    }).expect(200);
    const attempt = await ctx.prisma.attempt.findUnique({ where: { id: samAttempt } });
    expect(attempt?.score).toBe(5); // 2 + the dropped question's 3
    expect(attempt?.maxScore).toBe(10);

    await put(`/questions/${exam.questionIds.multi}/dropped`, {
      dropped: true,
      reason: 'Again please',
    }).expect(409);
    await put(`/questions/${exam.questionIds.multi}/dropped`, {
      dropped: false,
      reason: 'Changed my mind',
    }).expect(200);
    expect(await score()).toBe(2);
  });
});

describe('overriding one answer', () => {
  it('sets a mark by hand that survives a regrade, and clears it again', async () => {
    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: 1,
      reason: 'Half credit for the working shown',
    }).expect(200);
    expect(await singleMarks()).toBe(1);

    // Changing the key regrades everyone, but the hand-set mark stays.
    await put(`/questions/${exam.questionIds.single}/answer-key`, {
      correctOptions: [1],
      reason: 'key fix',
    }).expect(200);
    expect(await singleMarks()).toBe(1);

    await put(`/attempts/${samAttempt}/answers/${exam.questionIds.single}/override`, {
      marks: null,
    }).expect(200);
    expect(await singleMarks()).toBe(0);
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

describe('fixing wording', () => {
  it('changes text but not the number of options, and keeps the key', async () => {
    await ctx
      .http()
      .patch(`${base()}/questions/${exam.questionIds.single}/correction`)
      .set(auth(trainer))
      .send({ body: 'What does IaaS stand for?', reason: 'typo fix' })
      .expect(200);
    const q = await ctx.prisma.question.findUnique({ where: { id: exam.questionIds.single } });
    expect(q?.body).toBe('What does IaaS stand for?');
    expect(q?.correctOptions).toEqual([0]);
    await ctx
      .http()
      .patch(`${base()}/questions/${exam.questionIds.single}/correction`)
      .set(auth(trainer))
      .send({ options: ['Only', 'Two'] })
      .expect(409);
  });
});

describe('who and when', () => {
  it('is for the owning trainer only', async () => {
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await ctx
      .http()
      .put(`${base()}/questions/${exam.questionIds.single}/dropped`)
      .set(auth(other))
      .send({ dropped: true, reason: 'not my exam' })
      .expect(404);
  });

  it('is refused once results are published', async () => {
    await ctx.prisma.exam.update({ where: { id: exam.examId }, data: { status: 'RESULTS_FINAL' } });
    await put(`/questions/${exam.questionIds.single}/answer-key`, {
      correctOptions: [1],
      reason: 'too late',
    }).expect(409);
    expect(await score()).not.toBe(undefined);
  });
});
