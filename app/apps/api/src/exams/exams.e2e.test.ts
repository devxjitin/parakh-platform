import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { joinExam, newStudent, publishExam } from '../../test/scenario';
import { MemoryStorage, STORAGE } from '../storage/storage.service';

let ctx: TestContext;
let trainer: { accessToken: string };
let other: { accessToken: string };
let student: { accessToken: string };

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
  other = await signUp(ctx, { role: 'EXAMINER', email: 'other@example.com' });
  student = await signUp(ctx, { role: 'STUDENT', email: 'student@example.com' });
});

const auth = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });

async function newExam(token = trainer, body: object = {}) {
  const res = await ctx
    .http()
    .post('/exams')
    .set(auth(token))
    .send({ title: 'Network Security Basics', ...body })
    .expect(201);
  return res.body as { id: string };
}

const single = {
  type: 'SINGLE',
  body: 'Which port does HTTPS use?',
  options: ['80', '443', '22'],
  correctOptions: [1],
  marks: 4,
  explanation: 'TLS runs on 443',
};

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('exam access', () => {
  it('is for trainers only', async () => {
    await ctx.http().get('/exams').expect(401);
    await ctx.http().get('/exams').set(auth(student)).expect(403);
    await ctx.http().post('/exams').set(auth(student)).send({ title: 'Nope nope' }).expect(403);
  });

  it("hides one trainer's exams from another", async () => {
    const exam = await newExam();
    await ctx.http().get(`/exams/${exam.id}`).set(auth(other)).expect(404);
    await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(other))
      .send({ title: 'Stolen' })
      .expect(404);
    await ctx.http().delete(`/exams/${exam.id}`).set(auth(other)).expect(404);
    await ctx.http().post(`/exams/${exam.id}/questions`).set(auth(other)).send(single).expect(404);
    const list = await ctx.http().get('/exams').set(auth(other)).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('treats a malformed id as not found', async () => {
    await ctx.http().get('/exams/not-a-uuid').set(auth(trainer)).expect(404);
  });
});

describe('exam settings', () => {
  it('creates a draft with defaults and lists it', async () => {
    const res = await ctx
      .http()
      .post('/exams')
      .set(auth(trainer))
      .send({ title: 'Linux Admin Test' })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      durationMinutes: 60,
      passPercent: 40,
      shuffleQuestions: true,
      questionCount: 0,
      totalMarks: 0,
    });
    const list = await ctx.http().get('/exams').set(auth(trainer)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('validates settings', async () => {
    const bad = (body: object) =>
      ctx.http().post('/exams').set(auth(trainer)).send(body).expect(400);
    await bad({ title: 'ab' });
    await bad({ title: 'Valid title', durationMinutes: 2 });
    await bad({ title: 'Valid title', durationMinutes: 361 });
    await bad({ title: 'Valid title', passPercent: 101 });
    await bad({
      title: 'Valid title',
      startsAt: '2027-01-02T10:00:00Z',
      endsAt: '2027-01-01T10:00:00Z',
    });
  });

  it('closes by itself: start time plus duration, with no closing time to send', async () => {
    const exam = (
      await ctx
        .http()
        .post('/exams')
        .set(auth(trainer))
        .send({ title: 'Timed paper', startsAt: '2027-03-01T10:00:00.000Z', durationMinutes: 90 })
        .expect(201)
    ).body;
    expect(exam.endsAt).toBe('2027-03-01T11:30:00.000Z');

    const longer = (
      await ctx
        .http()
        .patch(`/exams/${exam.id}`)
        .set(auth(trainer))
        .send({ durationMinutes: 120 })
        .expect(200)
    ).body;
    expect(longer.endsAt).toBe('2027-03-01T12:00:00.000Z');

    const later = (
      await ctx
        .http()
        .patch(`/exams/${exam.id}`)
        .set(auth(trainer))
        .send({ startsAt: '2027-03-02T09:00:00.000Z' })
        .expect(200)
    ).body;
    expect(later.endsAt).toBe('2027-03-02T11:00:00.000Z');

    // Changing something else leaves the closing time alone.
    const same = (
      await ctx
        .http()
        .patch(`/exams/${exam.id}`)
        .set(auth(trainer))
        .send({ title: 'Renamed paper' })
        .expect(200)
    ).body;
    expect(same.endsAt).toBe('2027-03-02T11:00:00.000Z');

    // No start time yet means no closing time yet.
    const draft = (
      await ctx.http().post('/exams').set(auth(trainer)).send({ title: 'No start' }).expect(201)
    ).body;
    expect(draft.startsAt).toBeNull();
    expect(draft.endsAt).toBeNull();
  });

  it('updates settings and checks the window against stored values', async () => {
    const exam = await newExam(trainer, { startsAt: '2027-01-02T10:00:00Z' });
    const ok = await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(trainer))
      .send({ durationMinutes: 90, endsAt: '2027-01-02T12:00:00Z' })
      .expect(200);
    expect(ok.body.durationMinutes).toBe(90);
    await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(trainer))
      .send({ endsAt: '2027-01-01T00:00:00Z' })
      .expect(400);
    await ctx.http().patch(`/exams/${exam.id}`).set(auth(trainer)).send({}).expect(400);
  });

  it('blocks edits once the exam is not a draft', async () => {
    const exam = await newExam();
    await ctx.prisma.exam.update({ where: { id: exam.id }, data: { status: 'PUBLISHED' } });
    await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(trainer))
      .send({ title: 'Changed' })
      .expect(409);
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(409);
    await ctx.http().delete(`/exams/${exam.id}`).set(auth(trainer)).expect(409);
  });

  it('deletes a draft with its questions', async () => {
    const exam = await newExam();
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(201);
    await ctx.http().delete(`/exams/${exam.id}`).set(auth(trainer)).expect(204);
    expect(await ctx.prisma.question.count()).toBe(0);
  });
});

describe('questions', () => {
  it('adds single, multiple and subjective questions in order, with totals', async () => {
    const exam = await newExam();
    const add = (body: object) =>
      ctx.http().post(`/exams/${exam.id}/questions`).set(auth(trainer)).send(body);
    await add(single).expect(201);
    const multi = await add({
      type: 'MULTI',
      body: 'Pick the secure protocols',
      options: ['HTTP', 'HTTPS', 'SSH', 'Telnet'],
      correctOptions: [2, 1],
      marks: 6,
    }).expect(201);
    expect(multi.body.correctOptions).toEqual([1, 2]);
    expect(multi.body.position).toBe(2);
    await add({
      type: 'SUBJECTIVE',
      body: 'Explain TLS.',
      marks: 10,
      rubric: 'Mention handshake',
    }).expect(201);

    const detail = await ctx.http().get(`/exams/${exam.id}`).set(auth(trainer)).expect(200);
    expect(detail.body.questionCount).toBe(3);
    expect(detail.body.totalMarks).toBe(20);
    expect(detail.body.questions.map((q: { position: number }) => q.position)).toEqual([1, 2, 3]);
  });

  it('rejects invalid questions', async () => {
    const exam = await newExam();
    const add = (body: object) =>
      ctx.http().post(`/exams/${exam.id}/questions`).set(auth(trainer)).send(body).expect(400);
    await add({ ...single, correctOptions: [0, 1] }); // two answers on a single question
    await add({ ...single, correctOptions: [5] }); // option does not exist
    await add({ ...single, options: ['only one'], correctOptions: [0] });
    await add({ ...single, type: 'MULTI', correctOptions: [1] }); // multi needs two
    await add({
      type: 'CODING',
      body: 'Write a program to echo its input.',
      marks: 4,
      coding: {
        languages: ['python'],
        testCases: [{ input: 'hi', expectedOutput: 'hi', hidden: false, weight: 1 }],
      },
    });
    await add({ ...single, body: '   ' });
  });

  it('edits a question and ignores stale choice data when it becomes subjective', async () => {
    const exam = await newExam();
    const q = await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(201);
    const res = await ctx
      .http()
      .put(`/exams/${exam.id}/questions/${q.body.id}`)
      .set(auth(trainer))
      .send({ type: 'SUBJECTIVE', body: 'Describe HTTPS', marks: 5 })
      .expect(200);
    expect(res.body).toMatchObject({ type: 'SUBJECTIVE', options: [], correctOptions: [] });
  });

  it('cannot touch a question through another exam', async () => {
    const a = await newExam();
    const b = await newExam();
    const q = await ctx
      .http()
      .post(`/exams/${a.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(201);
    await ctx
      .http()
      .put(`/exams/${b.id}/questions/${q.body.id}`)
      .set(auth(trainer))
      .send(single)
      .expect(404);
    await ctx.http().delete(`/exams/${b.id}/questions/${q.body.id}`).set(auth(trainer)).expect(404);
  });

  it('renumbers after a delete and reorders', async () => {
    const exam = await newExam();
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const r = await ctx
        .http()
        .post(`/exams/${exam.id}/questions`)
        .set(auth(trainer))
        .send({ ...single, body: `Question ${n}` })
        .expect(201);
      ids.push(r.body.id);
    }
    await ctx.http().delete(`/exams/${exam.id}/questions/${ids[0]}`).set(auth(trainer)).expect(204);
    let detail = await ctx.http().get(`/exams/${exam.id}`).set(auth(trainer)).expect(200);
    expect(detail.body.questions.map((q: { position: number }) => q.position)).toEqual([1, 2]);

    const reordered = await ctx
      .http()
      .put(`/exams/${exam.id}/questions-order`)
      .set(auth(trainer))
      .send({ questionIds: [ids[2], ids[1]] })
      .expect(200);
    expect(reordered.body.map((q: { body: string }) => q.body)).toEqual([
      'Question 3',
      'Question 2',
    ]);

    // missing, duplicate or foreign ids are refused
    await ctx
      .http()
      .put(`/exams/${exam.id}/questions-order`)
      .set(auth(trainer))
      .send({ questionIds: [ids[2]] })
      .expect(400);
    await ctx
      .http()
      .put(`/exams/${exam.id}/questions-order`)
      .set(auth(trainer))
      .send({ questionIds: [ids[2], ids[2]] })
      .expect(400);
    detail = await ctx.http().get(`/exams/${exam.id}`).set(auth(trainer)).expect(200);
    expect(detail.body.questionCount).toBe(2);
  });
});

describe('paper plan marks', () => {
  it('moves the marks of questions already added when the plan changes', async () => {
    const exam = await newExam();
    const plan = (singleMarks: number) => ({
      totalQuestions: 2,
      singleCount: 2,
      multiCount: 0,
      subjectiveCount: 0,
      singleMarks,
      multiMarks: 0,
      subjectiveMarks: 0,
    });
    await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(trainer))
      .send({ paperPlan: plan(2) })
      .expect(200);
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send({ ...single, marks: 2 })
      .expect(201);
    const res = await ctx
      .http()
      .patch(`/exams/${exam.id}`)
      .set(auth(trainer))
      .send({ paperPlan: plan(5) })
      .expect(200);
    expect(res.body.questions[0].marks).toBe(5);
    expect(res.body.totalMarks).toBe(5);
  });
});

describe('bulk import', () => {
  const text = `Question 1: What is 2+2?
A. 3
B. 4
C. 5
Answer: B

Question 2: Pick the primes
A. 2
B. 3
C. 4
Answer: A, B`;

  it('previews without saving, then commits', async () => {
    const exam = await newExam();
    const url = `/exams/${exam.id}/questions-import`;
    const preview = await ctx
      .http()
      .post(url)
      .set(auth(trainer))
      .send({ text, defaultMarks: 2 })
      .expect(200);
    expect(preview.body).toMatchObject({ committed: false, found: 2 });
    expect(preview.body.questions[1].type).toBe('MULTI');
    expect(await ctx.prisma.question.count()).toBe(0);

    const done = await ctx
      .http()
      .post(url)
      .set(auth(trainer))
      .send({ text, defaultMarks: 2, commit: true })
      .expect(200);
    expect(done.body.committed).toBe(true);
    const detail = await ctx.http().get(`/exams/${exam.id}`).set(auth(trainer)).expect(200);
    expect(detail.body.questionCount).toBe(2);
    expect(detail.body.totalMarks).toBe(4);
    expect(detail.body.questions[0]).toMatchObject({
      marks: 2,
      correctOptions: [1],
    });
  });

  it('rejects text with no questions', async () => {
    const exam = await newExam();
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions-import`)
      .set(auth(trainer))
      .send({ text: 'just some words' })
      .expect(400);
  });

  it('enforces the 300-question limit', async () => {
    const exam = await newExam();
    const many = Array.from(
      { length: 301 },
      (_, i) => `Question ${i + 1}: Q${i + 1}?\nA. a\nB. b\nAnswer: A`,
    ).join('\n\n');
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions-import`)
      .set(auth(trainer))
      .send({ text: many, commit: true })
      .expect(400);
    expect(await ctx.prisma.question.count()).toBe(0);
  });
});

describe('student preview', () => {
  it('never leaks answers, explanations or rubrics', async () => {
    const exam = await newExam();
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(201);
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send({ type: 'SUBJECTIVE', body: 'Explain TLS', marks: 5, rubric: 'SECRET RUBRIC' })
      .expect(201);
    const res = await ctx.http().get(`/exams/${exam.id}/preview`).set(auth(trainer)).expect(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('correctOptions');
    expect(raw).not.toContain('TLS runs on 443');
    expect(raw).not.toContain('SECRET RUBRIC');
    expect(res.body.questions[0].options).toEqual(['80', '443', '22']);
    expect(res.body.totalMarks).toBe(9);
  });
});

describe('question images', () => {
  const formatted = {
    ...single,
    body: 'Find **x** in \\(x^2 = 4\\).',
    markdown: true,
    imageAlt: 'A graph of x squared',
  };

  it('validates uploads and keeps independent images on duplicated exams', async () => {
    const { id } = await newExam();
    const questions = `/exams/${id}/questions`;
    const attach = (file: Buffer, question = formatted) =>
      ctx
        .http()
        .post(questions)
        .set(auth(trainer))
        .field('question', JSON.stringify(question))
        .attach('file', file, 'graph.png');
    await attach(Buffer.from('Invalid image')).expect(400);
    await attach(Buffer.alloc(513 * 1024)).expect(413);
    await attach(PNG, { ...formatted, imageAlt: '' }).expect(400);
    const largestImage = Buffer.concat([PNG, Buffer.alloc(512 * 1024 - PNG.length)]);
    const created = await attach(largestImage).expect(201);
    expect(created.body).toMatchObject({ markdown: true, imageAlt: formatted.imageAlt });
    expect(created.body).not.toHaveProperty('imageKey');

    const question = `${questions}/${created.body.id}`;
    await ctx.http().get(`${question}/image`).expect(401);
    await ctx.http().get(`${question}/image`).set(auth(other)).expect(404);
    await ctx.http().get(`${question}/image`).set(auth(student)).expect(403);
    const image = await ctx.http().get(`${question}/image`).set(auth(trainer)).expect(200);
    expect(image.headers).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(image.body.equals(largestImage)).toBe(true);

    const copy = await ctx.http().post(`/exams/${id}/duplicate`).set(auth(trainer)).expect(201);
    const duplicated = copy.body.questions[0];
    expect(duplicated).toMatchObject({ markdown: true, imageAlt: formatted.imageAlt });
    const copyQuestion = `/exams/${copy.body.id}/questions/${duplicated.id}`;
    const storage = ctx.app.get<MemoryStorage>(STORAGE);
    const original = await ctx.prisma.question.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    const replacement = () =>
      ctx
        .http()
        .put(question)
        .set(auth(trainer))
        .field('question', JSON.stringify(formatted))
        .attach('file', PNG, 'new-graph.png')
        .expect(200);
    await Promise.all([replacement(), replacement()]);
    expect(await storage.get(original.imageKey!)).toBeNull();
    expect(
      [...storage.files.keys()].filter((key) => key.startsWith(`questions/${id}/`)),
    ).toHaveLength(1);

    await ctx.http().put(question).set(auth(trainer)).send(single).expect(200);
    await ctx.http().get(`${question}/image`).set(auth(trainer)).expect(200);
    await ctx
      .http()
      .put(question)
      .set(auth(trainer))
      .send({ ...single, imageAlt: null })
      .expect(200);
    await ctx.http().get(`${question}/image`).set(auth(trainer)).expect(404);
    await ctx.http().get(`${copyQuestion}/image`).set(auth(trainer)).expect(200);
    await ctx.http().delete(`/exams/${copy.body.id}`).set(auth(trainer)).expect(204);
    expect(
      [...storage.files.keys()].filter((key) => key.startsWith(`questions/${copy.body.id}/`)),
    ).toHaveLength(0);
  });

  it('follows attempt ownership, device binding, results visibility and practice eligibility', async () => {
    const { id } = await newExam(trainer, {
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    });
    const created = await ctx
      .http()
      .post(`/exams/${id}/questions`)
      .set(auth(trainer))
      .field('question', JSON.stringify(formatted))
      .attach('file', PNG, 'graph.png')
      .expect(201);
    const questionId = created.body.id;
    const order = await ctx
      .http()
      .post(`/exams/${id}/publish-order`)
      .set(auth(trainer))
      .expect(200);
    const paid = await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(trainer))
      .send({ orderId: order.body.orderId })
      .expect(200);
    const published = await ctx
      .http()
      .post('/payments/verify')
      .set(auth(trainer))
      .send(paid.body)
      .expect(200);
    // Published with a future start, as required; now let the exam be open.
    await ctx.prisma.exam.update({
      where: { id },
      data: { startsAt: new Date(Date.now() - 3_600_000) },
    });
    const stranger = await newStudent(ctx, 'stranger@example.com');
    const enrollmentId = await joinExam(ctx, student, published.body.exam.code);
    const device = 'exam-device-student-01';
    const started = await ctx
      .http()
      .post('/attempts')
      .set(auth(student))
      .set('X-Device-Id', device)
      .send({ enrollmentId })
      .expect(200);
    expect(started.body.questions[0]).toMatchObject({
      id: questionId,
      markdown: true,
      imageAlt: formatted.imageAlt,
    });
    const path = `/attempts/${started.body.id}/questions/${questionId}/image`;
    const practice = `/practice/${id}/questions/${questionId}/image`;
    await ctx.http().get(path).set(auth(stranger)).set('X-Device-Id', device).expect(404);
    await ctx
      .http()
      .get(path)
      .set(auth(student))
      .set('X-Device-Id', 'exam-device-student-02')
      .expect(403);
    await ctx.http().get(path).set(auth(student)).set('X-Device-Id', device).expect(200);
    await ctx.http().get(practice).set(auth(student)).expect(403);
    await ctx
      .http()
      .put(`/exams/${id}/questions/${questionId}`)
      .set(auth(trainer))
      .field('question', JSON.stringify(formatted))
      .attach('file', PNG, 'graph.png')
      .expect(409);

    await ctx
      .http()
      .post(`/attempts/${started.body.id}/submit`)
      .set(auth(student))
      .set('X-Device-Id', device)
      .expect(200);
    await ctx.http().get(path).set(auth(student)).expect(404);
    await ctx.prisma.exam.update({ where: { id }, data: { endsAt: new Date(Date.now() - 60000) } });
    await ctx.http().get(practice).set(auth(stranger)).expect(403);
    await ctx.http().get(practice).set(auth(student)).expect(200);
    await ctx.http().post(`/exams/${id}/finalize`).set(auth(trainer)).expect(200);
    await ctx.http().get(path).set(auth(student)).expect(200);
  });
});

describe('logo', () => {
  it('stores a PNG privately, serves it to the owner only, and replaces it', async () => {
    const exam = await newExam();
    const put = () =>
      ctx.http().put(`/exams/${exam.id}/logo`).set(auth(trainer)).attach('file', PNG, 'logo.png');
    await put().expect(200);
    const detail = await ctx.http().get(`/exams/${exam.id}`).set(auth(trainer)).expect(200);
    expect(detail.body.hasLogo).toBe(true);

    const img = await ctx.http().get(`/exams/${exam.id}/logo`).set(auth(trainer)).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    await ctx.http().get(`/exams/${exam.id}/logo`).set(auth(other)).expect(404);
    await ctx.http().get(`/exams/${exam.id}/logo`).expect(401);

    const first = (await ctx.prisma.exam.findUnique({ where: { id: exam.id } }))!.logoKey;
    await put().expect(200);
    const second = (await ctx.prisma.exam.findUnique({ where: { id: exam.id } }))!.logoKey;
    expect(second).not.toBe(first);

    await ctx.http().delete(`/exams/${exam.id}/logo`).set(auth(trainer)).expect(204);
    await ctx.http().get(`/exams/${exam.id}/logo`).set(auth(trainer)).expect(404);
  });

  it('rejects non-images (even when labelled as images), SVG and oversized files', async () => {
    const exam = await newExam();
    const attach = (data: Buffer, name: string, type: string) =>
      ctx
        .http()
        .put(`/exams/${exam.id}/logo`)
        .set(auth(trainer))
        .attach('file', data, { filename: name, contentType: type });
    await attach(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'a.svg',
      'image/svg+xml',
    ).expect(400);
    await attach(Buffer.from('MZ not an image'), 'a.png', 'image/png').expect(400);
    await attach(Buffer.concat([PNG, Buffer.alloc(700 * 1024)]), 'big.png', 'image/png').expect(
      413,
    );
    await ctx.http().put(`/exams/${exam.id}/logo`).set(auth(trainer)).expect(400);
  });
});

describe('AI paper builder', () => {
  const brief = {
    title: 'Cloud Basics',
    subject: 'Cloud Computing',
    topics: [
      { name: 'Networking', count: 2 },
      { name: 'Security', count: 1 },
    ],
    total: 3,
    types: { single: 1, multi: 1, written: 1 },
    difficulty: { easy: 1, medium: 1, hard: 1 },
    optionsPerQuestion: 4,
    audience: 'Beginners',
    language: 'English',
    marks: { single: 2, multi: 3, written: 5 },
    partialCredit: true,
  };
  const answer = (extra: object[] = []) =>
    '```json\n' +
    JSON.stringify({
      schema: 'parakh.paper.v1',
      questions: [
        {
          type: 'SINGLE',
          topic: 'Networking',
          difficulty: 'EASY',
          body: 'Which layer routes?',
          options: ['Data link', 'Network', 'Transport', 'Session'],
          correct: ['B'],
          explanation: 'Layer 3',
        },
        {
          type: 'MULTI',
          topic: 'Networking',
          difficulty: 'MEDIUM',
          body: 'Private ranges?',
          options: ['10.0.0.0/8', '172.16.0.0/12', '8.8.8.0/24'],
          correct: ['A', 'B'],
        },
        {
          type: 'SUBJECTIVE',
          topic: 'Security',
          difficulty: 'HARD',
          body: 'Explain TLS.',
          rubric: 'Key exchange',
        },
        ...extra,
      ],
    }) +
    '\n```';
  const send = (token: { accessToken: string }, id: string, body: object) =>
    ctx.http().post(`/exams/${id}/questions-ai-import`).set(auth(token)).send(body);
  const questionsOf = async (id: string) =>
    (await ctx.http().get(`/exams/${id}`).set(auth(trainer)).expect(200)).body;

  it('checks without saving questions, then imports with marks from the brief', async () => {
    const exam = await newExam();
    const dry = await send(trainer, exam.id, { text: answer(), brief }).expect(200);
    expect(dry.body.committed).toBe(false);
    expect(dry.body.check.valid).toHaveLength(3);
    expect(dry.body.check.warnings).toEqual([]);
    expect(await ctx.prisma.question.count()).toBe(0);

    const done = await send(trainer, exam.id, { text: answer(), brief, commit: true }).expect(200);
    expect(done.body).toMatchObject({ committed: true, room: 297 });
    const detail = await questionsOf(exam.id);
    expect(detail.questionCount).toBe(3);
    expect(detail.totalMarks).toBe(10);
    const [first, second, third] = detail.questions;
    expect(first).toMatchObject({
      type: 'SINGLE',
      correctOptions: [1],
      marks: 2,
      explanation: 'Layer 3',
      position: 1,
    });
    expect(second).toMatchObject({
      type: 'MULTI',
      correctOptions: [0, 1],
      marks: 3,
      partialCredit: true,
    });
    expect(third).toMatchObject({ type: 'SUBJECTIVE', marks: 5, rubric: 'Key exchange' });
  });

  it('adds to the end of what is already there and never replaces it', async () => {
    const exam = await newExam();
    await ctx
      .http()
      .post(`/exams/${exam.id}/questions`)
      .set(auth(trainer))
      .send(single)
      .expect(201);
    await send(trainer, exam.id, { text: answer(), brief, commit: true }).expect(200);
    const detail = await questionsOf(exam.id);
    expect(detail.questions.map((q: { position: number }) => q.position)).toEqual([1, 2, 3, 4]);
    expect(detail.questions[0].body).toBe(single.body);
  });

  it('imports the good questions and reports the bad one', async () => {
    const exam = await newExam();
    const bad = { type: 'SINGLE', body: 'Broken?', options: ['a', 'b'], correct: ['D'] };
    const four = {
      ...brief,
      total: 4,
      types: { single: 2, multi: 1, written: 1 },
      difficulty: { easy: 2, medium: 1, hard: 1 },
      topics: [
        { name: 'Networking', count: 3 },
        { name: 'Security', count: 1 },
      ],
    };
    const res = await send(trainer, exam.id, {
      text: answer([bad]),
      brief: four,
      commit: true,
    }).expect(200);
    expect(res.body.check.valid).toHaveLength(3);
    expect(res.body.check.problems).toEqual([
      { number: 4, message: 'The correct answer D does not exist; there are only 2 options.' },
    ]);
    expect(await ctx.prisma.question.count()).toBe(3);
  });

  it('refuses a commit with nothing readable, but a check shows why', async () => {
    const exam = await newExam();
    const dry = await send(trainer, exam.id, { text: 'Sorry, I cannot help', brief }).expect(200);
    expect(dry.body.check.fatal).toMatch(/No JSON/);
    await send(trainer, exam.id, { text: 'Sorry, I cannot help', brief, commit: true }).expect(400);
    await send(trainer, exam.id, { text: answer().slice(0, 120), brief, commit: true }).expect(400);
    expect(await ctx.prisma.question.count()).toBe(0);
  });

  it('flags a question that is already in the draft', async () => {
    const exam = await newExam();
    await send(trainer, exam.id, { text: answer(), brief, commit: true }).expect(200);
    const again = await send(trainer, exam.id, { text: answer(), brief }).expect(200);
    expect(again.body.check.warnings).toContain('Question 1 is already in this exam.');
  });

  it('is only for the owner, only for drafts, and respects the 300 limit', async () => {
    const exam = await newExam();
    await send(other, exam.id, { text: answer(), brief }).expect(404);
    await send(student, exam.id, { text: answer(), brief }).expect(403);
    await send(trainer, exam.id, { text: answer(), brief: { ...brief, total: 0 } }).expect(400);

    const published = await publishExam(ctx, trainer);
    await send(trainer, published.examId, { text: answer(), brief, commit: true }).expect(409);

    await ctx.prisma.question.createMany({
      data: Array.from({ length: 299 }, (_, i) => ({
        examId: exam.id,
        position: i + 1,
        type: 'SUBJECTIVE' as const,
        body: `Filler ${i}`,
        options: [],
        correctOptions: [],
        marks: 1,
      })),
    });
    await send(trainer, exam.id, { text: answer(), brief, commit: true }).expect(400);
    expect(await ctx.prisma.question.count({ where: { examId: exam.id } })).toBe(299);
  });

  it('writes an audit row with counts only, never the pasted text', async () => {
    const exam = await newExam();
    await send(trainer, exam.id, { text: answer(), brief, commit: true }).expect(200);
    const row = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'question.ai_import' },
    });
    expect(row.meta).toEqual({ count: 3, skipped: 0, part: 0 });
    expect(JSON.stringify(row)).not.toContain('Which layer routes');
  });

  it('keeps the brief, returns it with the exam, and copies it when duplicated', async () => {
    const exam = await newExam();
    await ctx.http().put(`/exams/${exam.id}/ai-brief`).set(auth(trainer)).send(brief).expect(200);
    await ctx.http().put(`/exams/${exam.id}/ai-brief`).set(auth(other)).send(brief).expect(404);
    await ctx
      .http()
      .put(`/exams/${exam.id}/ai-brief`)
      .set(auth(trainer))
      .send({ ...brief, total: 9 })
      .expect(400); // the parts do not add up
    expect((await questionsOf(exam.id)).aiBrief).toMatchObject({
      subject: 'Cloud Computing',
      total: 3,
    });

    const copy = (
      await ctx.http().post(`/exams/${exam.id}/duplicate`).set(auth(trainer)).expect(201)
    ).body;
    expect(copy.aiBrief).toMatchObject({ subject: 'Cloud Computing' });

    // a check also remembers the brief
    const fresh = await newExam();
    await send(trainer, fresh.id, { text: answer(), brief }).expect(200);
    expect((await questionsOf(fresh.id)).aiBrief).toMatchObject({ title: 'Cloud Basics' });
  });

  it('puts the brief in the trainer data download, but not any AI answer', async () => {
    const exam = await newExam();
    await send(trainer, exam.id, { text: answer(), brief }).expect(200);
    const data = (await ctx.http().get('/users/me/data').set(auth(trainer)).expect(200)).body;
    expect(data.examsYouCreated[0].aiBrief).toMatchObject({ subject: 'Cloud Computing' });
    expect(JSON.stringify(data)).not.toContain('parakh.paper.v1');
  });
});
