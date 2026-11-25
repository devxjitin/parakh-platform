import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createAdmin, createTestApp, lastCode, signUp } from '../../test/helpers';
import { auth } from '../../test/scenario';

let ctx: TestContext;
let admin: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  admin = await createAdmin(ctx);
  await ctx.prisma.examCategory.create({ data: { name: 'Programming' } });
});

/** An admin builds and publishes an always-open exam (no dates, no creation fee). */
async function publishAlwaysOpen(opts: { written: boolean }) {
  const exam = await ctx
    .http()
    .post('/exams')
    .set(auth(admin))
    .send({
      title: 'AI Agent Interview Prep',
      durationMinutes: 30,
      alwaysOpen: true,
      catalogCategory: 'Programming',
      catalogSummary: 'Self-test for AI agent interviews',
      catalogTopics: ['RAG', 'Agents', 'Prompting'],
      studentFeePaise: 9900,
    })
    .expect(201);
  expect(exam.body).toMatchObject({ alwaysOpen: true, startsAt: null, endsAt: null });
  const id = exam.body.id as string;
  const add = async (body: object) =>
    (await ctx.http().post(`/exams/${id}/questions`).set(auth(admin)).send(body).expect(201)).body
      .id as string;
  const single = await add({
    type: 'SINGLE',
    body: 'What does RAG stand for?',
    options: ['Retrieval Augmented Generation', 'Random Access Graph', 'Rapid Agent Gateway'],
    correctOptions: [0],
    marks: 2,
    explanation: 'SECRET EXPLANATION',
  });
  const written = opts.written
    ? await add({
        type: 'SUBJECTIVE',
        body: 'Explain tool calling',
        marks: 3,
        rubric: 'SECRET RUBRIC',
      })
    : null;
  const published = (await ctx.http().post(`/exams/${id}/publish`).set(auth(admin)).expect(200))
    .body;
  return { id, code: published.code as string, single, written };
}

async function studentJoins(code: string, email = 'asha@example.com') {
  await ctx
    .http()
    .post(`/auth/join/${code}/start`)
    .send({ name: 'Asha Rao', email, acceptTerms: true })
    .expect(202);
  const res = await ctx
    .http()
    .post('/auth/join/verify')
    .send({ name: 'Asha Rao', email, code: lastCode(ctx.mail, email) })
    .expect(200);
  const student = { accessToken: res.body.accessToken as string };
  const order = (await ctx.http().post(`/join/${code}/order`).set(auth(student)).expect(200)).body;
  const paid = (
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(student))
      .send({ orderId: order.orderId })
      .expect(200)
  ).body;
  const done = (await ctx.http().post('/payments/verify').set(auth(student)).send(paid).expect(200))
    .body;
  return { student, enrollmentId: done.enrollmentId as string };
}

const startAttempt = async (s: { accessToken: string }, enrollmentId: string) =>
  (await ctx.http().post('/attempts').set(auth(s)).send({ enrollmentId }).expect(200)).body
    .id as string;

describe('exam categories', () => {
  it('an always-open exam must be filed under a category an admin created', async () => {
    const create = (body: object) =>
      ctx
        .http()
        .post('/exams')
        .set(auth(admin))
        .send({
          title: 'Prep exam',
          alwaysOpen: true,
          catalogSummary: 'A summary',
          catalogTopics: ['RAG'],
          ...body,
        });
    await create({ catalogCategory: undefined }).expect(400);
    await create({ catalogCategory: 'Not a category' }).expect(400);
    const ok = await create({ catalogCategory: 'programming' }).expect(201);
    expect(ok.body.catalogCategory).toBe('Programming');
  });

  it('only an admin manages categories; names are unique and one in use cannot be deleted', async () => {
    const trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
    await ctx.http().get('/admin/categories').set(auth(trainer)).expect(403);
    const made = (
      await ctx
        .http()
        .post('/admin/categories')
        .set(auth(admin))
        .send({ name: 'Cloud' })
        .expect(201)
    ).body;
    await ctx.http().post('/admin/categories').set(auth(admin)).send({ name: 'cloud' }).expect(409);
    await ctx
      .http()
      .post('/exams')
      .set(auth(admin))
      .send({
        title: 'Cloud prep',
        alwaysOpen: true,
        catalogCategory: 'Cloud',
        catalogSummary: 'A summary',
        catalogTopics: ['IaaS'],
      })
      .expect(201);
    await ctx.http().delete(`/admin/categories/${made.id}`).set(auth(admin)).expect(400);
    const renamed = (
      await ctx
        .http()
        .patch(`/admin/categories/${made.id}`)
        .set(auth(admin))
        .send({ name: 'Cloud Computing' })
        .expect(200)
    ).body;
    expect(renamed).toMatchObject({ name: 'Cloud Computing', examCount: 1 });
    const list = (await ctx.http().get('/admin/categories').set(auth(admin)).expect(200)).body;
    expect(list.map((c: { name: string }) => c.name)).toEqual(['Cloud Computing', 'Programming']);
  });
});

describe('always-open exams', () => {
  it('only an admin can make one, and it needs a summary and topics for the list', async () => {
    const trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
    await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Trainer exam', alwaysOpen: true })
      .expect(400);
    const create = (body: object) =>
      ctx
        .http()
        .post('/exams')
        .set(auth(admin))
        .send({ title: 'Prep exam', alwaysOpen: true, catalogCategory: 'Programming', ...body });
    await create({}).expect(400);
    await create({ catalogSummary: 'A summary' }).expect(400);
    await create({ catalogTopics: ['RAG'] }).expect(400);
    await create({ catalogSummary: 'A summary', catalogTopics: ['RAG'] }).expect(201);
  });

  it('fixes the type when the exam is created and tells the two kinds apart in the list', async () => {
    const draft = (
      await ctx
        .http()
        .post('/exams')
        .set(auth(admin))
        .send({
          title: 'Always open draft',
          alwaysOpen: true,
          catalogCategory: 'Programming',
          catalogSummary: 'A summary',
          catalogTopics: ['RAG'],
        })
        .expect(201)
    ).body;
    const scheduled = (
      await ctx
        .http()
        .post('/exams')
        .set(auth(admin))
        .send({ title: 'Scheduled draft' })
        .expect(201)
    ).body;
    await ctx
      .http()
      .patch(`/exams/${draft.id}`)
      .set(auth(admin))
      .send({ alwaysOpen: false })
      .expect(400);
    await ctx
      .http()
      .patch(`/exams/${scheduled.id}`)
      .set(auth(admin))
      .send({ alwaysOpen: true })
      .expect(400);
    const rows = (await ctx.http().get('/exams').set(auth(admin)).expect(200)).body as {
      id: string;
      alwaysOpen: boolean;
    }[];
    expect(rows.find((r) => r.id === draft.id)?.alwaysOpen).toBe(true);
    expect(rows.find((r) => r.id === scheduled.id)?.alwaysOpen).toBe(false);
  });

  it('publishes without dates and appears on the public list with metadata only', async () => {
    const exam = await publishAlwaysOpen({ written: true });
    const list = (await ctx.http().get('/catalog/exams').expect(200)).body;
    expect(list.exams).toHaveLength(1);
    expect(list.exams[0]).toMatchObject({
      code: exam.code,
      title: 'AI Agent Interview Prep',
      topics: ['RAG', 'Agents', 'Prompting'],
      questionCount: 2,
      totalMarks: 5,
      durationMinutes: 30,
      feePaise: 9900,
      hasWrittenQuestions: true,
    });
    const raw = JSON.stringify(list);
    for (const leak of ['SECRET', 'Retrieval Augmented', 'correctOptions', 'rubric']) {
      expect(raw).not.toContain(leak);
    }
    expect((await ctx.http().get(`/catalog/exams/${exam.code}`).expect(200)).body.code).toBe(
      exam.code,
    );
    const info = (await ctx.http().get(`/join/${exam.code}`).expect(200)).body;
    expect(info).toMatchObject({ alwaysOpen: true, state: 'OPEN', startsAt: null, endsAt: null });
  });

  it('lists every published always-open exam, and nothing about it can change after publish', async () => {
    const exam = await publishAlwaysOpen({ written: false });
    // listed automatically, with no switch to flip
    expect((await ctx.http().get('/catalog/exams').expect(200)).body.exams).toHaveLength(1);

    const patch = (body: object) =>
      ctx.http().patch(`/exams/${exam.id}`).set(auth(admin)).send(body);
    // the exam, its settings and even the list card are locked once published
    await patch({ catalogSummary: 'Better summary', catalogTopics: ['LLMs'] }).expect(409);
    await patch({ title: 'New title' }).expect(409);
    const card = (await ctx.http().get(`/catalog/exams/${exam.code}`).expect(200)).body;
    expect(card.summary).not.toBe('Better summary');
  });

  it('keeps a draft off the list until it is published', async () => {
    await ctx
      .http()
      .post('/exams')
      .set(auth(admin))
      .send({
        title: 'Draft',
        alwaysOpen: true,
        catalogCategory: 'Programming',
        catalogSummary: 'Not live yet',
        catalogTopics: ['RAG'],
      })
      .expect(201);
    expect((await ctx.http().get('/catalog/exams').expect(200)).body.exams).toHaveLength(0);
  });

  it('emails an objective-only result the moment the student submits', async () => {
    const exam = await publishAlwaysOpen({ written: false });
    const { student, enrollmentId } = await studentJoins(exam.code);
    const attemptId = await startAttempt(student, enrollmentId);
    await ctx
      .http()
      .put(`/attempts/${attemptId}/answers/${exam.single}`)
      .set(auth(student))
      .send({ selected: [0] })
      .expect(200);
    await ctx.http().post(`/attempts/${attemptId}/submit`).set(auth(student)).expect(200);

    await expect
      .poll(
        async () =>
          (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status,
      )
      .toBe('RESULT_PUBLISHED');
    const sent = ctx.mail.lastTo('asha@example.com');
    expect(sent?.subject).toMatch(/AI Agent Interview Prep/);
  });

  it('holds a written paper for admin review, then releases it when marked', async () => {
    const exam = await publishAlwaysOpen({ written: true });
    const { student, enrollmentId } = await studentJoins(exam.code);
    const attemptId = await startAttempt(student, enrollmentId);
    await ctx
      .http()
      .put(`/attempts/${attemptId}/answers/${exam.single}`)
      .set(auth(student))
      .send({ selected: [0] })
      .expect(200);
    await ctx
      .http()
      .put(`/attempts/${attemptId}/answers/${exam.written}`)
      .set(auth(student))
      .send({ text: 'The model asks for a tool and the app runs it.' })
      .expect(200);
    await ctx.http().post(`/attempts/${attemptId}/submit`).set(auth(student)).expect(200);

    // waiting for the admin
    const row = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(row.status).not.toBe('RESULT_PUBLISHED');
    const queue = (await ctx.http().get('/admin/reviews').set(auth(admin)).expect(200)).body;
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      attemptId,
      studentEmail: 'asha@example.com',
      pendingAnswers: 1,
      overdue: false,
    });

    // the admin marks it: the result is released straight away
    await ctx
      .http()
      .put(`/exams/${exam.id}/attempts/${attemptId}/answers/${exam.written}/grade`)
      .set(auth(admin))
      .send({ marks: 2, feedback: 'Good start' })
      .expect(200);
    await expect
      .poll(
        async () =>
          (await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).status,
      )
      .toBe('RESULT_PUBLISHED');
    const done = await ctx.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(done).toMatchObject({ score: 4, maxScore: 5 });
    expect(
      (await ctx.http().get('/admin/reviews').set(auth(admin)).expect(200)).body.items,
    ).toEqual([]);
    // There is no exam-wide publish for an always-open exam.
    await ctx.http().post(`/exams/${exam.id}/finalize`).set(auth(admin)).expect(409);
  });

  it('flags a review as overdue after 24 hours', async () => {
    const exam = await publishAlwaysOpen({ written: true });
    const { student, enrollmentId } = await studentJoins(exam.code);
    const attemptId = await startAttempt(student, enrollmentId);
    await ctx
      .http()
      .put(`/attempts/${attemptId}/answers/${exam.written}`)
      .set(auth(student))
      .send({ text: 'An answer' })
      .expect(200);
    await ctx.http().post(`/attempts/${attemptId}/submit`).set(auth(student)).expect(200);
    await ctx.prisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const queue = (await ctx.http().get('/admin/reviews').set(auth(admin)).expect(200)).body;
    expect(queue.items[0].overdue).toBe(true);
  });

  it('takes one attempt per payment', async () => {
    const exam = await publishAlwaysOpen({ written: false });
    const { student, enrollmentId } = await studentJoins(exam.code);
    await ctx.http().post(`/join/${exam.code}/order`).set(auth(student)).expect(409);
    const attemptId = await startAttempt(student, enrollmentId);
    expect(await startAttempt(student, enrollmentId)).toBe(attemptId);
  });

  it('lets a student who already paid sit a retired exam, but sells no new seats', async () => {
    const exam = await publishAlwaysOpen({ written: false });
    const { student, enrollmentId } = await studentJoins(exam.code);

    await ctx.http().post(`/exams/${exam.id}/close`).set(auth(admin)).expect(200);
    expect((await ctx.http().get('/catalog/exams').expect(200)).body.exams).toHaveLength(0);
    expect((await ctx.http().get(`/join/${exam.code}`).expect(200)).body.state).toBe('ENDED');

    const attemptId = await startAttempt(student, enrollmentId);
    const attempt = (await ctx.http().get(`/attempts/${attemptId}`).set(auth(student)).expect(200))
      .body;
    expect(new Date(attempt.deadlineAt).getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
  });
});

describe('public pricing', () => {
  it('shows the live platform prices to anyone, and follows an admin change', async () => {
    const before = (await ctx.http().get('/catalog/pricing').expect(200)).body;
    expect(before).toEqual({
      examCreationPaise: expect.any(Number),
      examJoinPaise: expect.any(Number),
      examinerSharePercent: expect.any(Number),
    });
    await ctx.prisma.platformSetting.upsert({
      where: { key: 'platform' },
      create: {
        key: 'platform',
        value: { ...before, examJoinPaise: 12_300, minPayoutPaise: 50_000 },
        updatedBy: null,
      },
      update: { value: { ...before, examJoinPaise: 12_300, minPayoutPaise: 50_000 } },
    });
    const after = (await ctx.http().get('/catalog/pricing').expect(200)).body;
    expect(after.examJoinPaise).toBe(12_300);
  });
});
