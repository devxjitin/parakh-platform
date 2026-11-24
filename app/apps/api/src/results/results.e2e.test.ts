import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';

let ctx: TestContext;
let trainer: { accessToken: string };
let sam: { accessToken: string };
let exam: PublishedExam;
let samAttempt: string;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});

/** Exam: single 2 marks (option 0), multi 3 marks (options 0+1), written 5 marks. Total 10. */
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  sam = await newStudent(ctx, 'sam@example.com');
  exam = await publishExam(ctx, trainer);
  samAttempt = await startAttempt(sam);
});

async function startAttempt(student: { accessToken: string }): Promise<string> {
  const enrollmentId = await joinExam(ctx, student, exam.code);
  const res = await ctx
    .http()
    .post('/attempts')
    .set(auth(student))
    .send({ enrollmentId })
    .expect(200);
  return res.body.id as string;
}

const answer = (who: { accessToken: string }, attempt: string, q: string, body: object) =>
  ctx.http().put(`/attempts/${attempt}/answers/${q}`).set(auth(who)).send(body).expect(200);

const submit = (who: { accessToken: string }, attempt: string) =>
  ctx.http().post(`/attempts/${attempt}/submit`).set(auth(who)).expect(200);

/** Sam answers everything correctly and submits; the written answer waits for the trainer. */
async function samPerfect() {
  const q = exam.questionIds;
  await answer(sam, samAttempt, q.single, { selected: [0] });
  await answer(sam, samAttempt, q.multi, { selected: [0, 1] });
  await answer(sam, samAttempt, q.subjective, { text: 'The provider secures the cloud itself.' });
  await submit(sam, samAttempt);
}

const results = () => ctx.http().get(`/exams/${exam.examId}/results`).set(auth(trainer));
const grade = (
  marks: number,
  feedback?: string,
  attempt = samAttempt,
  q = exam.questionIds.subjective,
) =>
  ctx
    .http()
    .put(`/exams/${exam.examId}/attempts/${attempt}/answers/${q}/grade`)
    .set(auth(trainer))
    .send({ marks, feedback });
const finalize = () => ctx.http().post(`/exams/${exam.examId}/finalize`).set(auth(trainer));
const closeExam = () =>
  ctx.prisma.exam.update({
    where: { id: exam.examId },
    data: { endsAt: new Date(Date.now() - 1000) },
  });

describe('automatic marking at submit', () => {
  it('marks choice questions at once and leaves the written one waiting', async () => {
    await samPerfect();
    const r = (await results().expect(200)).body;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      status: 'SUBMITTED',
      pendingGrading: 1,
      score: null,
      percent: null,
    });
    expect(r.stats.pendingGrading).toBe(1);
    const stored = await ctx.prisma.answer.findMany({ where: { attemptId: samAttempt } });
    const byQ = Object.fromEntries(stored.map((a) => [a.questionId, a.marksAwarded]));
    expect(byQ[exam.questionIds.single]).toBe(2);
    expect(byQ[exam.questionIds.multi]).toBe(3);
    expect(byQ[exam.questionIds.subjective]).toBeNull();
  });

  it('scores immediately when there is no written answer to read', async () => {
    const q = exam.questionIds;
    await answer(sam, samAttempt, q.single, { selected: [0] });
    await submit(sam, samAttempt); // multi unanswered, written blank
    const row = (await results().expect(200)).body.rows[0];
    expect(row).toMatchObject({ status: 'GRADED', score: 2, percent: 20, passed: false });
  });

  it('gives zero for a wrong answer, there is no negative marking', async () => {
    await answer(sam, samAttempt, exam.questionIds.single, { selected: [2] });
    await submit(sam, samAttempt);
    const row = (await results().expect(200)).body.rows[0];
    expect(row.score).toBe(0);
    const stored = await ctx.prisma.answer.findFirstOrThrow({
      where: { attemptId: samAttempt, questionId: exam.questionIds.single },
    });
    expect(stored.marksAwarded).toBe(0);
  });

  it('gives partial credit on multiple-answer questions when the question allows it', async () => {
    await ctx.prisma.question.update({
      where: { id: exam.questionIds.multi },
      data: { partialCredit: true },
    });
    await answer(sam, samAttempt, exam.questionIds.multi, { selected: [0] });
    await submit(sam, samAttempt);
    const stored = await ctx.prisma.answer.findFirstOrThrow({
      where: { attemptId: samAttempt, questionId: exam.questionIds.multi },
    });
    expect(stored.marksAwarded).toBe(1.5);
  });

  it('marks an attempt that ended by strikes', async () => {
    await answer(sam, samAttempt, exam.questionIds.single, { selected: [0] });
    for (let i = 0; i < 3; i++) {
      await ctx
        .http()
        .post(`/attempts/${samAttempt}/events`)
        .set(auth(sam))
        .send({ type: 'TAB_HIDDEN' })
        .expect(200);
      await ctx.prisma.proctorEvent.updateMany({
        where: { attemptId: samAttempt },
        data: { createdAt: new Date(Date.now() - 60_000 * (i + 1)) },
      });
      await ctx.prisma.attempt.update({
        where: { id: samAttempt },
        data: { lastStrikeAt: new Date(Date.now() - 60_000 * (i + 1)) },
      });
    }
    const row = (await results().expect(200)).body.rows[0];
    expect(row).toMatchObject({ status: 'GRADED', endReason: 'STRIKES', score: 2 });
  });

  it('ends and marks attempts whose time ran out while nobody was watching', async () => {
    await answer(sam, samAttempt, exam.questionIds.single, { selected: [0] });
    await ctx.prisma.attempt.update({
      where: { id: samAttempt },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });
    const row = (await results().expect(200)).body.rows[0];
    expect(row).toMatchObject({ status: 'GRADED', endReason: 'TIME_UP', score: 2 });
  });
});

describe('marking written answers', () => {
  beforeEach(samPerfect);

  it('records marks and feedback and completes the score', async () => {
    await grade(4, 'Good, mention the customer side too.').expect(200);
    const row = (await results().expect(200)).body.rows[0];
    expect(row).toMatchObject({ status: 'GRADED', score: 9, percent: 90, passed: true });
    expect(row.pendingGrading).toBe(0);
  });

  it('lets the trainer change marks until results are published', async () => {
    await grade(5).expect(200);
    await grade(1).expect(200);
    expect((await results().expect(200)).body.rows[0].score).toBe(6);
  });

  it('rejects marks above the question maximum or below zero', async () => {
    await grade(6).expect(409);
    await grade(-1).expect(400);
  });

  it('only written answers can be marked by hand', async () => {
    await grade(1, undefined, samAttempt, exam.questionIds.single).expect(404);
  });

  it('cannot mark a student who is still in the exam', async () => {
    const lena = await newStudent(ctx, 'lena@example.com');
    const lenaAttempt = await startAttempt(lena);
    await answer(lena, lenaAttempt, exam.questionIds.subjective, { text: 'draft' });
    await grade(3, undefined, lenaAttempt).expect(409);
    await ctx
      .http()
      .get(`/exams/${exam.examId}/attempts/${lenaAttempt}`)
      .set(auth(trainer))
      .expect(409);
  });

  it('shows the grading screen with answers, correct options, rubric and violations', async () => {
    const d = (
      await ctx
        .http()
        .get(`/exams/${exam.examId}/attempts/${samAttempt}`)
        .set(auth(trainer))
        .expect(200)
    ).body;
    expect(d.studentEmail).toBe('sam@example.com');
    const written = d.questions.find((q: { type: string }) => q.type === 'SUBJECTIVE');
    expect(written).toMatchObject({
      rubric: 'SECRET RUBRIC',
      text: 'The provider secures the cloud itself.',
      marksAwarded: null,
    });
    const choice = d.questions.find((q: { type: string }) => q.type === 'SINGLE');
    expect(choice).toMatchObject({ correctOptions: [0], selected: [0], marksAwarded: 2 });
  });

  it('only the owning trainer can see or mark', async () => {
    const other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
    await ctx.http().get(`/exams/${exam.examId}/results`).set(auth(other)).expect(404);
    await ctx
      .http()
      .put(
        `/exams/${exam.examId}/attempts/${samAttempt}/answers/${exam.questionIds.subjective}/grade`,
      )
      .set(auth(other))
      .send({ marks: 5 })
      .expect(404);
    await ctx.http().get(`/exams/${exam.examId}/results`).set(auth(sam)).expect(403);
    await ctx.http().get(`/exams/${exam.examId}/results`).expect(401);
  });
});

describe('publishing results', () => {
  it('waits until the exam has closed', async () => {
    await samPerfect();
    await grade(5).expect(200);
    await finalize().expect(409); // exam is open for three more hours
  });

  it('waits until every written answer is marked', async () => {
    await samPerfect();
    await closeExam();
    const res = await finalize().expect(409);
    expect(res.body.message).toMatch(/written answers to mark/);
  });

  it('waits for students who are still taking the exam', async () => {
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() + 60_000) },
    });
    await closeExam();
    await finalize().expect(409);
  });

  it('keeps results hidden from students until published', async () => {
    await samPerfect();
    await grade(4).expect(200);
    await ctx.http().get(`/attempts/${samAttempt}/result`).set(auth(sam)).expect(409);
    const mine = (await ctx.http().get('/me/enrollments').set(auth(sam)).expect(200)).body;
    expect(mine[0].result).toBeNull();
  });

  it('publishes: students see score and a full review, marks lock, the exam closes', async () => {
    await samPerfect();
    await grade(4, 'Nicely put').expect(200);
    await closeExam();
    const done = (await finalize().expect(200)).body;
    expect(done.finalized).toBe(true);
    expect(done.exam.status).toBe('RESULTS_FINAL');
    expect(done.stats).toMatchObject({ average: 9, highest: 9, passRate: 100 });

    const r = (await ctx.http().get(`/attempts/${samAttempt}/result`).set(auth(sam)).expect(200))
      .body;
    expect(r).toMatchObject({ score: 9, maxScore: 10, percent: 90, passed: true });
    expect(r.questions).toHaveLength(3);
    const written = r.questions.find((q: { type: string }) => q.type === 'SUBJECTIVE');
    expect(written).toMatchObject({ marksAwarded: 4, feedback: 'Nicely put' });
    const single = r.questions.find((q: { type: string }) => q.type === 'SINGLE');
    expect(single).toMatchObject({ correctOptions: [0], explanation: 'SECRET EXPLANATION' });

    const mine = (await ctx.http().get('/me/enrollments').set(auth(sam)).expect(200)).body;
    expect(mine[0].result).toEqual({ score: 9, maxScore: 10, percent: 90, passed: true });

    await grade(1).expect(409); // locked
    await finalize().expect(409); // already done
  });

  it('two simultaneous finalize calls publish once', async () => {
    await samPerfect();
    await grade(4).expect(200);
    await closeExam();
    const codes = (await Promise.all([finalize(), finalize()])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
  });

  it("one student cannot read another's result", async () => {
    await samPerfect();
    await grade(4).expect(200);
    await closeExam();
    await finalize().expect(200);
    const lena = await newStudent(ctx, 'lena@example.com');
    await ctx.http().get(`/attempts/${samAttempt}/result`).set(auth(lena)).expect(404);
  });

  it('students who never started simply have no result', async () => {
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, lena, exam.code);
    await samPerfect();
    await grade(4).expect(200);
    await closeExam();
    const done = (await finalize().expect(200)).body;
    expect(done.exam.enrolled).toBe(2);
    expect(done.rows).toHaveLength(1);
  });
});

describe('csv export', () => {
  it('downloads a spreadsheet and neutralises formulas in names', async () => {
    await ctx.prisma.user.update({
      where: { email: 'sam@example.com' },
      data: { name: '=HYPERLINK("http://evil")' },
    });
    await samPerfect();
    await grade(4).expect(200);
    const res = await ctx
      .http()
      .get(`/exams/${exam.examId}/results.csv`)
      .set(auth(trainer))
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".+\.csv"/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Email,Status,Submitted at,Score,Out of,Percent,Result,Strikes,Violations,Ended by',
    );
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(lines[1]).toContain(',9,10,90,Pass,');
  });

  it('is trainer-only', async () => {
    await ctx.http().get(`/exams/${exam.examId}/results.csv`).set(auth(sam)).expect(403);
  });
});
