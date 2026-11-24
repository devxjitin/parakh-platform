/**
 * Imports the old Exam Hall data (see legacy-import.ts for what moves).
 *
 * 1. Export from the old SQLite file, one JSON file per table:
 *      sqlite3 -json exam_hall.db "select * from users"     > users.json
 *      sqlite3 -json exam_hall.db "select * from exams"     > exams.json
 *      sqlite3 -json exam_hall.db "select * from questions" > questions.json
 * 2. Look first (nothing is written):
 *      LEGACY_DIR=./export npm run migrate:legacy -w @parakh/api -- --dry-run
 * 3. Then for real (drop --dry-run). Add --include-demo to also bring the demo accounts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importLegacy, type LegacyData } from './legacy-import';

async function main() {
  const dir = process.env.LEGACY_DIR;
  if (!dir)
    throw new Error('Set LEGACY_DIR to the folder with users.json, exams.json, questions.json');
  const read = (name: string) => {
    const text = readFileSync(join(dir, `${name}.json`), 'utf8').trim();
    return text ? JSON.parse(text) : [];
  };
  const data: LegacyData = {
    users: read('users'),
    exams: read('exams'),
    questions: read('questions'),
  };
  const dryRun = process.argv.includes('--dry-run');
  const includeDemo = process.argv.includes('--include-demo');

  const prisma = new PrismaClient();
  try {
    const r = await importLegacy(prisma, data, { dryRun, includeDemo });
    console.log(dryRun ? 'DRY RUN (nothing written)' : 'Imported');
    console.log(`  users created:    ${r.usersCreated} (already there: ${r.usersExisting})`);
    console.log(`  exams created:    ${r.examsCreated} (as drafts)`);
    console.log(`  questions:        ${r.questionsCreated}`);
    for (const s of r.skipped) console.log(`  skipped ${s}`);
    if (!dryRun && r.usersCreated > 0) {
      await prisma.auditLog.create({
        data: { action: 'admin.legacy_import', meta: { ...r, skipped: r.skipped.length } },
      });
      console.log('\nTell migrated users to use "Forgot password" to set a new password.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
