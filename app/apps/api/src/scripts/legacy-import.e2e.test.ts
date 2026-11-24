import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp } from '../../test/helpers';
import { LegacyData, importLegacy, legacyUuid } from './legacy-import';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const data = (): LegacyData => ({
  users: [
    {
      id: 'usr_1',
      role: 'examiner',
      name: 'Dr. Rao',
      email: 'Rao@Example.com',
      phone: '9999999999',
      upi_id: 'rao@okbank',
    },
    { id: 'usr_2', role: 'student', name: 'Mina', email: 'mina@example.com' },
    { id: 'usr_3', role: 'examiner', name: 'Bad Mail', email: 'not-an-email' },
    { id: 'usr_4', role: 'admin', name: 'Old Admin', email: 'oldadmin@example.com' },
    { id: 'usr_examiner_demo', role: 'examiner', name: 'Demo', email: 'examiner@examhall.com' },
  ],
  exams: [
    {
      id: 'ex_1',
      examiner_id: 'usr_1',
      title: 'Science Quiz',
      duration_mins: 15,
      description: 'Hi',
    },
    { id: 'ex_2', examiner_id: 'usr_3', title: 'Orphan exam', duration_mins: 20 },
    { id: 'ex_demo', examiner_id: 'usr_examiner_demo', title: 'Demo exam', duration_mins: 20 },
  ],
  questions: [
    {
      id: 'q_1',
      exam_id: 'ex_1',
      type: 'mcq',
      question_text: 'Which protocol is secure?',
      options_json: '["HTTP","HTTPS","FTP"]',
      correct_option: 1,
      positive_marks: 4,
      negative_marks: 1,
      order_num: 1,
    },
    {
      id: 'q_2',
      exam_id: 'ex_1',
      type: 'theory',
      question_text: 'Explain gravity.',
      max_marks: 10,
      model_answer: 'Mass attracts mass.',
      order_num: 2,
    },
    {
      id: 'q_3',
      exam_id: 'ex_1',
      type: 'mcq',
      question_text: 'Broken one',
      options_json: 'not json',
      correct_option: 0,
      order_num: 3,
    },
    {
      id: 'q_4',
      exam_id: 'ex_2',
      type: 'mcq',
      question_text: 'Belongs to a skipped exam',
      options_json: '["a","b"]',
      correct_option: 0,
      order_num: 1,
    },
  ],
});

describe('importing Exam Hall data', () => {
  it('brings trainers, students, draft exams and questions, and says what it skipped', async () => {
    const report = await importLegacy(ctx.prisma, data());
    expect(report).toMatchObject({ usersCreated: 2, examsCreated: 1, questionsCreated: 2 });
    expect(report.skipped.join('\n')).toMatch(/usr_3: invalid email/);
    expect(report.skipped.join('\n')).toMatch(/usr_4: role "admin"/);
    expect(report.skipped.join('\n')).toMatch(/demo account/);
    expect(report.skipped.join('\n')).toMatch(/exam ex_2: its trainer was not migrated/);
    expect(report.skipped.join('\n')).toMatch(/q_3: choices or correct answer/);

    const rao = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'rao@example.com' },
      include: { examinerProfile: true },
    });
    expect(rao).toMatchObject({ role: 'EXAMINER', phone: '9999999999', name: 'Dr. Rao' });
    expect(rao.examinerProfile).toMatchObject({ payoutMethod: 'UPI', upiId: 'rao@okbank' });
    expect(rao.emailVerifiedAt).not.toBeNull();

    const exam = await ctx.prisma.exam.findFirstOrThrow({
      where: { examinerId: rao.id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    expect(exam).toMatchObject({ title: 'Science Quiz', status: 'DRAFT', durationMinutes: 15 });
    expect(exam.questions).toHaveLength(2);
    expect(exam.questions[0]).toMatchObject({
      type: 'SINGLE',
      options: ['HTTP', 'HTTPS', 'FTP'],
      correctOptions: [1],
      marks: 4,
    });
    expect(exam.questions[1]).toMatchObject({
      type: 'SUBJECTIVE',
      marks: 10,
      rubric: 'Mass attracts mass.',
    });
  });

  it('gives every trainer a password nobody knows, so they must reset it', async () => {
    await importLegacy(ctx.prisma, data());
    const rao = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'rao@example.com' } });
    expect(rao.passwordHash).toMatch(/^\$argon2id\$/);
    for (const guess of ['exam123', 'student123', 'password', '']) {
      await ctx
        .http()
        .post('/auth/login')
        .send({ email: 'rao@example.com', password: guess })
        .expect((r) => expect([400, 401]).toContain(r.status));
    }
    // ...and the normal "forgot password" flow works
    await ctx.http().post('/auth/forgot-password').send({ email: 'rao@example.com' }).expect(202);
    const code = ctx.mail.lastTo('rao@example.com')?.text.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeTruthy();
    await ctx
      .http()
      .post('/auth/reset-password')
      .send({ email: 'rao@example.com', code, newPassword: 'NewStr0ng!Pass1' })
      .expect(200);
    await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'rao@example.com', password: 'NewStr0ng!Pass1' })
      .expect(200);
  });

  it('can be run again without doubling anything', async () => {
    await importLegacy(ctx.prisma, data());
    const again = await importLegacy(ctx.prisma, data());
    expect(again).toMatchObject({
      usersCreated: 0,
      usersExisting: 2,
      examsCreated: 0,
      questionsCreated: 0,
    });
    expect(await ctx.prisma.user.count()).toBe(2);
    expect(await ctx.prisma.exam.count()).toBe(1);
    expect(await ctx.prisma.question.count()).toBe(2);
  });

  it('does nothing on a dry run, and does not overwrite people who already have an account', async () => {
    const dry = await importLegacy(ctx.prisma, data(), { dryRun: true });
    expect(dry).toMatchObject({ usersCreated: 2, examsCreated: 1, questionsCreated: 2 });
    expect(await ctx.prisma.user.count()).toBe(0);

    await ctx.prisma.user.create({
      data: { email: 'mina@example.com', name: 'New Mina', passwordHash: 'kept', role: 'STUDENT' },
    });
    const real = await importLegacy(ctx.prisma, data());
    expect(real.usersExisting).toBe(1);
    const mina = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'mina@example.com' } });
    expect(mina).toMatchObject({ name: 'New Mina', passwordHash: 'kept' });
  });

  it('brings the demo accounts only when asked', async () => {
    const r = await importLegacy(ctx.prisma, data(), { includeDemo: true });
    expect(r.usersCreated).toBe(3);
    expect(r.examsCreated).toBe(2);
  });

  it('maps the same old id to the same new id', () => {
    expect(legacyUuid('user', 'usr_1')).toBe(legacyUuid('user', 'usr_1'));
    expect(legacyUuid('user', 'usr_1')).not.toBe(legacyUuid('exam', 'usr_1'));
    expect(legacyUuid('user', 'usr_1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
