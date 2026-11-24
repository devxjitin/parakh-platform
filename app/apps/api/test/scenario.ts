import { TestContext, signUp } from './helpers';

export const auth = (t: { accessToken: string }) => ({ Authorization: `Bearer ${t.accessToken}` });
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

export interface PublishedExam {
  examId: string;
  code: string;
  questionIds: { single: string; multi: string; subjective: string };
  /** Ids of the extra questions passed to publishExam, in order. */
  extraIds: string[];
}

/** A trainer creates a 3-question exam and pays to publish it (fake gateway). */
export async function publishExam(
  ctx: TestContext,
  trainer: { accessToken: string },
  settings: Record<string, unknown> = {},
  extra: object[] = [],
): Promise<PublishedExam> {
  const exam = await ctx
    .http()
    .post('/exams')
    .set(auth(trainer))
    .send({
      title: 'Cloud Fundamentals',
      durationMinutes: 60,
      startsAt: hours(-1),
      endsAt: hours(3),
      ...settings,
    })
    .expect(201);
  const id = exam.body.id as string;
  const add = async (body: object) =>
    (await ctx.http().post(`/exams/${id}/questions`).set(auth(trainer)).send(body).expect(201)).body
      .id as string;
  const single = await add({
    type: 'SINGLE',
    body: 'What is IaaS?',
    options: ['Infrastructure', 'Internet', 'Integration', 'Island'],
    correctOptions: [0],
    marks: 2,
    explanation: 'SECRET EXPLANATION',
  });
  const multi = await add({
    type: 'MULTI',
    body: 'Pick public clouds',
    options: ['AWS', 'Azure', 'Excel'],
    correctOptions: [0, 1],
    marks: 3,
  });
  const subjective = await add({
    type: 'SUBJECTIVE',
    body: 'Explain shared responsibility',
    marks: 5,
    rubric: 'SECRET RUBRIC',
  });
  const extraIds: string[] = [];
  for (const q of extra) extraIds.push(await add(q));

  const order = (await ctx.http().post(`/exams/${id}/publish-order`).set(auth(trainer)).expect(200))
    .body;
  const paid = (
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(trainer))
      .send({ orderId: order.orderId })
      .expect(200)
  ).body;
  const done = await ctx.http().post('/payments/verify').set(auth(trainer)).send(paid).expect(200);
  return {
    examId: id,
    code: done.body.exam.code as string,
    questionIds: { single, multi, subjective },
    extraIds,
  };
}

/** A student pays the join fee for an exam code; returns their enrollment id. */
export async function joinExam(
  ctx: TestContext,
  student: { accessToken: string },
  code: string,
): Promise<string> {
  const order = (await ctx.http().post(`/join/${code}/order`).set(auth(student)).expect(200)).body;
  const paid = (
    await ctx
      .http()
      .post('/payments/fake/complete')
      .set(auth(student))
      .send({ orderId: order.orderId })
      .expect(200)
  ).body;
  const done = await ctx.http().post('/payments/verify').set(auth(student)).send(paid).expect(200);
  return done.body.enrollmentId as string;
}

export async function newStudent(ctx: TestContext, email: string) {
  return signUp(ctx, { role: 'STUDENT', email, name: 'Sam Student' });
}
