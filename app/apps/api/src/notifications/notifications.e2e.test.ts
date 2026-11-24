import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp, signUp } from '../../test/helpers';
import { PublishedExam, auth, joinExam, newStudent, publishExam } from '../../test/scenario';
import { NotificationsService } from './notifications.service';

type Token = { accessToken: string };

let ctx: TestContext;
let notify: NotificationsService;
let trainer: Token;
let exam: PublishedExam;

beforeAll(async () => {
  ctx = await createTestApp();
  notify = ctx.app.get(NotificationsService);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  trainer = await signUp(ctx, { role: 'EXAMINER', email: 'trainer@example.com' });
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
const startsIn = (h: number) =>
  ctx.prisma.exam.update({
    where: { id: exam.examId },
    data: { startsAt: hours(h), endsAt: hours(h + 3) },
  });

describe('exam reminders', () => {
  beforeEach(async () => {
    exam = await publishExam(ctx, trainer);
  });

  it('emails a joined student once, when the exam is less than a day away', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    await startsIn(5);
    ctx.mail.clear();

    expect(await notify.sendReminders()).toBe(1);
    const mail = ctx.mail.lastTo('sam@example.com');
    expect(mail?.subject).toMatch(/Reminder: Cloud Fundamentals starts soon/);
    expect(mail?.text).toMatch(/60 minutes/);

    // a second pass sends nothing
    expect(await notify.sendReminders()).toBe(0);
  });

  it('waits when the exam is further away, and skips exams that already started', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    await joinExam(ctx, sam, exam.code);
    ctx.mail.clear();

    await startsIn(48);
    expect(await notify.sendReminders()).toBe(0);
    await startsIn(-1); // started an hour ago
    expect(await notify.sendReminders()).toBe(0);
    expect(ctx.mail.lastTo('sam@example.com')).toBeUndefined();

    await startsIn(23);
    expect(await notify.sendReminders()).toBe(1);
  });

  it('does not remind someone who already started, or a suspended student', async () => {
    const sam = await newStudent(ctx, 'sam@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200);
    const lena = await newStudent(ctx, 'lena@example.com');
    await joinExam(ctx, lena, exam.code);
    await ctx.prisma.user.update({
      where: { email: 'lena@example.com' },
      data: { status: 'SUSPENDED' },
    });
    await startsIn(5);
    ctx.mail.clear();
    expect(await notify.sendReminders()).toBe(0);
    expect(ctx.mail.lastTo('sam@example.com')).toBeUndefined();
    expect(ctx.mail.lastTo('lena@example.com')).toBeUndefined();
  });

  it('never sends twice, even when two servers run at the same moment', async () => {
    for (const e of ['a', 'b', 'c']) {
      await joinExam(ctx, await newStudent(ctx, `${e}@example.com`), exam.code);
    }
    await startsIn(5);
    ctx.mail.clear();
    const now = new Date();
    // a second instance (the `running` flag is per instance) claims the same rows
    const other = new NotificationsService(
      ctx.prisma,
      ctx.app.get(NotificationsService)['mail'],
      ctx.app.get(NotificationsService)['env'],
    );
    const [x, y] = await Promise.all([notify.sendReminders(now), other.sendReminders(now)]);
    expect(x + y).toBe(3);
    expect(ctx.mail.outbox.filter((m) => /Reminder/.test(m.subject))).toHaveLength(3);
  });
});

describe('results out', () => {
  it('emails each student their score when the trainer publishes (there is no account to look it up in)', async () => {
    exam = await publishExam(ctx, trainer);
    const sam = await newStudent(ctx, 'sam@example.com');
    const enrollmentId = await joinExam(ctx, sam, exam.code);
    const attempt = (
      await ctx.http().post('/attempts').set(auth(sam)).send({ enrollmentId }).expect(200)
    ).body.id;
    await ctx.http().post(`/attempts/${attempt}/submit`).set(auth(sam)).expect(200);
    // the exam window closes and the written answer is marked
    await ctx.prisma.exam.update({
      where: { id: exam.examId },
      data: { endsAt: new Date(Date.now() - 60_000) },
    });
    await ctx.prisma.answer.updateMany({
      where: { attemptId: attempt, marksAwarded: null },
      data: { marksAwarded: 0, gradedAt: new Date() },
    });
    await ctx.prisma.attempt.update({ where: { id: attempt }, data: { status: 'GRADED' } });
    ctx.mail.clear();

    await ctx.http().post(`/exams/${exam.examId}/finalize`).set(auth(trainer)).expect(200);
    const mail = ctx.mail.lastTo('sam@example.com');
    expect(mail?.subject).toBe('Your results are out: Cloud Fundamentals');
    expect(mail?.text).toMatch(/Your score: \d+(\.\d+)? \/ 10/);
    expect(mail?.text).not.toContain('/result/');
    expect(mail?.text).toMatch(/practice code/i);
  });
});
