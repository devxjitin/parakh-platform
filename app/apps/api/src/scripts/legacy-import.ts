import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Algorithm, hash } from '@node-rs/argon2';
import { emailSchema } from '@parakh/shared';

/**
 * Brings data from the old Exam Hall app into Parakh.
 *
 * What moves: trainers and students (with their phone and UPI id), exams (as DRAFTS, because the
 * trainer must pay the creation fee to publish) and their questions.
 * What does not: passwords (the old ones were plain text, so everyone gets an unusable one and
 * must use "Forgot password") and old submissions (different scoring rules, no audit trail).
 *
 * Running it twice is safe: every record gets an id derived from its old id, so nothing doubles.
 */

export interface LegacyData {
  users: LegacyUser[];
  exams: LegacyExam[];
  questions: LegacyQuestion[];
}
export interface LegacyUser {
  id: string;
  role: string;
  name: string;
  email: string;
  phone?: string | null;
  upi_id?: string | null;
}
export interface LegacyExam {
  id: string;
  examiner_id: string;
  title: string;
  description?: string | null;
  duration_mins: number;
}
export interface LegacyQuestion {
  id: string;
  exam_id: string;
  type: string;
  question_text: string;
  options_json?: string | null;
  correct_option?: number | null;
  positive_marks?: number | null;
  negative_marks?: number | null;
  max_marks?: number | null;
  model_answer?: string | null;
  order_num: number;
}

export interface ImportReport {
  usersCreated: number;
  usersExisting: number;
  examsCreated: number;
  questionsCreated: number;
  skipped: string[];
}

/** The same old id always maps to the same UUID (version 5 style). */
export function legacyUuid(kind: string, id: string): string {
  const h = createHash('sha1').update(`parakh-legacy:${kind}:${id}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const UPI = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,32}$/;
const isDemo = (u: LegacyUser) => /_demo$/.test(u.id) || /@examhall\.com$/i.test(u.email);

export async function importLegacy(
  prisma: PrismaClient,
  data: LegacyData,
  opts: { dryRun?: boolean; includeDemo?: boolean } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    usersCreated: 0,
    usersExisting: 0,
    examsCreated: 0,
    questionsCreated: 0,
    skipped: [],
  };
  const dry = opts.dryRun ?? false;
  const owner = new Map<string, string>(); // old user id -> new user id

  // One slow hash is enough: nobody can sign in with it, they reset their password instead.
  const unusable = await hash(randomBytes(32).toString('hex'), {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const u of data.users) {
    if (!opts.includeDemo && isDemo(u)) {
      report.skipped.push(`user ${u.id}: demo account`);
      continue;
    }
    const role = u.role === 'examiner' ? 'EXAMINER' : u.role === 'student' ? 'STUDENT' : null;
    if (!role) {
      report.skipped.push(`user ${u.id}: role "${u.role}" is not migrated`);
      continue;
    }
    const email = emailSchema.safeParse(u.email);
    if (!email.success) {
      report.skipped.push(`user ${u.id}: invalid email`);
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { email: email.data } });
    if (existing) {
      owner.set(u.id, existing.id);
      report.usersExisting++;
      continue;
    }
    const id = legacyUuid('user', u.id);
    owner.set(u.id, id);
    report.usersCreated++;
    if (dry) continue;
    await prisma.user.create({
      data: {
        id,
        email: email.data,
        name: u.name.trim().slice(0, 100) || 'Migrated user',
        phone: u.phone?.trim() || null,
        passwordHash: unusable,
        role,
        // They prove ownership of the email with the reset code, so it counts as verified.
        emailVerifiedAt: new Date(),
        ...(role === 'EXAMINER'
          ? {
              examinerProfile: {
                create:
                  u.upi_id && UPI.test(u.upi_id.trim())
                    ? { payoutMethod: 'UPI', upiId: u.upi_id.trim() }
                    : {},
              },
            }
          : {}),
      },
    });
  }

  const examIds = new Set<string>();
  for (const e of data.exams) {
    const examinerId = owner.get(e.examiner_id);
    if (!examinerId) {
      report.skipped.push(`exam ${e.id}: its trainer was not migrated`);
      continue;
    }
    const id = legacyUuid('exam', e.id);
    examIds.add(e.id);
    if (await prisma.exam.findUnique({ where: { id } })) continue;
    report.examsCreated++;
    if (dry) continue;
    await prisma.exam.create({
      data: {
        id,
        examinerId,
        title: e.title.trim().slice(0, 150).padEnd(3, '.'),
        description: e.description?.trim().slice(0, 2000) || null,
        durationMinutes: Math.max(5, Math.round(e.duration_mins) || 60),
        status: 'DRAFT',
      },
    });
  }

  for (const q of data.questions) {
    if (!examIds.has(q.exam_id)) continue;
    const id = legacyUuid('question', q.id);
    if (await prisma.question.findUnique({ where: { id } })) continue;
    const isChoice = q.type === 'mcq';
    let options: string[] = [];
    if (isChoice) {
      try {
        options = (JSON.parse(q.options_json ?? '[]') as unknown[]).map((o) => String(o));
      } catch {
        options = [];
      }
      const correct = q.correct_option ?? -1;
      if (options.length < 2 || correct < 0 || correct >= options.length) {
        report.skipped.push(`question ${q.id}: choices or correct answer are not usable`);
        continue;
      }
    }
    report.questionsCreated++;
    if (dry) continue;
    await prisma.question.create({
      data: {
        id,
        examId: legacyUuid('exam', q.exam_id),
        position: q.order_num,
        type: isChoice ? 'SINGLE' : 'SUBJECTIVE',
        body: q.question_text,
        options,
        correctOptions: isChoice ? [q.correct_option as number] : [],
        marks: isChoice ? (q.positive_marks ?? 1) : (q.max_marks ?? 5),
        rubric: !isChoice ? q.model_answer?.slice(0, 3000) || null : null,
      },
    });
  }
  return report;
}
