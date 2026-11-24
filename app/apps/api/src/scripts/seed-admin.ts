/**
 * Creates (or promotes) the first NandiVex admin. Admins cannot self-register.
 *
 *   ADMIN_EMAIL=you@nandivex.in ADMIN_PASSWORD='...' ADMIN_NAME='Your Name' npm run seed:admin -w @parakh/api
 */
import { PrismaClient } from '@prisma/client';
import { Algorithm, hash } from '@node-rs/argon2';
import { emailSchema, passwordSchema } from '@parakh/shared';

async function main() {
  const email = emailSchema.parse(process.env.ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
  const name = process.env.ADMIN_NAME?.trim() || 'NandiVex Admin';

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
      update: { name, passwordHash, role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: { action: 'admin.seeded', entity: 'User', entityId: user.id },
    });
    console.log(`Admin ready: ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
