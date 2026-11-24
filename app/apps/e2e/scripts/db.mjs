// Tiny database helper for the browser tests: `node scripts/db.mjs close-exam <examId>` moves an
// exam's closing time into the past (the tests cannot wait for a real exam window to end), and
// `clear-otps` forgets old emailed codes so a student can ask for a fresh one straight away.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { PrismaClient } = createRequire(join(root, 'apps', 'api', 'package.json'))('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      // start-api.mjs writes the address of this run's database here.
      url: readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.db-url'), 'utf8'),
    },
  },
});

const [command, examId] = process.argv.slice(2);
try {
  if (command === 'clear-otps') {
    // The API waits a minute between emailed codes; the tests cannot, so they clear the old ones.
    await prisma.emailOtp.deleteMany({});
  } else if (command === 'session-token') {
    // A finished exam cannot be joined again, so a student who needs a session afterwards gets a
    // sign-in token straight from the database (the same kind the browser keeps in its cookie).
    const user = await prisma.user.findUniqueOrThrow({ where: { email: examId } });
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await prisma.refreshToken.create({
      data: {
        id,
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: createHash('sha256').update(secret).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    process.stdout.write(`${id}.${secret}`);
  } else if (command === 'close-exam' && examId) {
    await prisma.exam.update({
      where: { id: examId },
      data: { endsAt: new Date(Date.now() - 60 * 60_000) },
    });
  } else {
    throw new Error('usage: db.mjs close-exam <examId> | clear-otps | session-token <email>');
  }
} finally {
  await prisma.$disconnect();
}
