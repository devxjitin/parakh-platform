/**
 * Creates test students and an open exam for the k6 load test (docs/LOAD_TEST.md), straight in
 * the database, so no emails or payments are involved. Everything it makes uses the address
 * domain `loadtest.invalid`, so `--cleanup` can remove exactly that and nothing else.
 *
 *   LOAD_SEED_TARGET=<database host> npm run seed:load -w @parakh/api -- --yes --students 500
 *   LOAD_SEED_TARGET=<database host> npm run seed:load -w @parakh/api -- --yes --cleanup
 *
 * It only runs when LOAD_SEED_TARGET equals the host in DATABASE_URL, so it cannot be pointed at
 * the wrong database by accident. Never run it against production.
 */
import { PrismaClient } from '@prisma/client';
import { Algorithm, hash } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

export const LOAD_DOMAIN = 'loadtest.invalid';
export const LOAD_EXAM_TITLE = 'LOAD TEST EXAM';
const TRAINER_EMAIL = `load-trainer@${LOAD_DOMAIN}`;
const QUESTION_COUNT = 20;

export interface SeedOptions {
  students: number;
  minutes: number;
  password: string;
}

export interface SeedResult {
  examId: string;
  code: string;
  emails: string[];
  /**
   * One refresh token per student (same order as emails). Students have no password, so the load
   * test signs each one in by renewing a session, exactly like a returning browser does.
   */
  refreshTokens: string[];
}

/** Makes the trainer, one open exam with 20 questions, and N verified students already enrolled. */
export async function seedLoadTest(prisma: PrismaClient, opts: SeedOptions): Promise<SeedResult> {
  const existing = await prisma.user.count({ where: { email: { endsWith: `@${LOAD_DOMAIN}` } } });
  if (existing > 0) throw new Error('Load-test data already exists. Run with --cleanup first.');

  const passwordHash = await hash(opts.password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const now = new Date();
  const trainer = await prisma.user.create({
    data: {
      email: TRAINER_EMAIL,
      name: 'Load Trainer',
      passwordHash,
      role: 'EXAMINER',
      emailVerifiedAt: now,
    },
  });
  const code = 'LOADTEST1';
  const exam = await prisma.exam.create({
    data: {
      examinerId: trainer.id,
      title: LOAD_EXAM_TITLE,
      status: 'PUBLISHED',
      durationMinutes: opts.minutes,
      startsAt: new Date(now.getTime() - 3_600_000),
      endsAt: new Date(now.getTime() + 8 * 3_600_000),
      publishedAt: now,
      code,
      // No warnings or auto-submit: a load test has no real student to look away.
      strikePolicy: 'OFF',
      questions: {
        create: Array.from({ length: QUESTION_COUNT }, (_, i) => ({
          position: i + 1,
          type: 'SINGLE' as const,
          body: `Load test question ${i + 1}`,
          options: ['A', 'B', 'C', 'D'],
          correctOptions: [i % 4],
          marks: 1,
        })),
      },
    },
  });

  const emails = Array.from(
    { length: opts.students },
    (_, i) => `load-student-${String(i + 1).padStart(4, '0')}@${LOAD_DOMAIN}`,
  );
  await prisma.user.createMany({
    data: emails.map((email, i) => ({
      email,
      name: `Load Student ${i + 1}`,
      passwordHash,
      role: 'STUDENT' as const,
      emailVerifiedAt: now,
    })),
  });
  const students = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  await prisma.enrollment.createMany({
    data: students.map((s) => ({ examId: exam.id, studentId: s.id })),
  });
  const idOf = new Map(
    (
      await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    ).map((u) => [u.email, u.id]),
  );
  const tokens = emails.map((email) => {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    return { id, secret, userId: idOf.get(email)! };
  });
  await prisma.refreshToken.createMany({
    data: tokens.map((t) => ({
      id: t.id,
      userId: t.userId,
      familyId: randomUUID(),
      tokenHash: createHash('sha256').update(t.secret).digest('hex'),
      expiresAt: new Date(now.getTime() + 2 * 86_400_000),
    })),
  });
  return { examId: exam.id, code, emails, refreshTokens: tokens.map((t) => `${t.id}.${t.secret}`) };
}

/** Removes exactly what seedLoadTest made (and what the load test created while running). */
export async function cleanupLoadTest(prisma: PrismaClient): Promise<{ users: number }> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${LOAD_DOMAIN}` } },
    select: { id: true, email: true },
  });
  const ids = users.map((u) => u.id);
  // Answers and proctoring events go with their attempts.
  await prisma.attempt.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.exam.deleteMany({ where: { examinerId: { in: ids } } });
  await prisma.loginFailure.deleteMany({ where: { email: { endsWith: `@${LOAD_DOMAIN}` } } });
  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return { users: removed.count };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    const n = i >= 0 ? Number(args[i + 1]) : fallback;
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number`);
    return n;
  };

  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!flag('yes') || process.env.LOAD_SEED_TARGET !== host) {
    throw new Error(
      `Refusing to run. This would change the database at "${host}". ` +
        `Pass --yes and set LOAD_SEED_TARGET=${host} to confirm it is the right one.`,
    );
  }
  const prisma = new PrismaClient();
  try {
    if (flag('cleanup')) {
      const { users } = await cleanupLoadTest(prisma);
      console.log(`Removed ${users} load-test users and their exam data.`);
      return;
    }
    const password =
      process.env.LOAD_PASSWORD ?? `Load-${Math.random().toString(36).slice(2, 12)}9`;
    const result = await seedLoadTest(prisma, {
      students: value('students', 500),
      minutes: value('minutes', 30),
      password,
    });
    console.log(`Exam code ${result.code}, ${result.emails.length} students enrolled.`);
    const out = process.env.LOAD_TOKENS_FILE ?? 'load-tokens.json';
    writeFileSync(out, JSON.stringify(result.refreshTokens));
    console.log(
      `Student sign-in tokens written to ${out} (give it to k6 as TOKENS_FILE). Keep it private.`,
    );
    console.log(`Emails: ${result.emails[0]} ... ${result.emails[result.emails.length - 1]}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
