import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('LeaderLock');

/** A background pass can take a while; the lock is held for as long as it runs. */
const MAX_PASS_MS = 10 * 60_000;

/**
 * Runs `pass` only if no other server is already running the job with the same `name`.
 * It takes a Postgres advisory lock that lasts for one transaction, so it is released
 * automatically when the pass ends or the server dies. Returns false if another server held it.
 * Only the timers use this; tests and admin buttons call the job methods directly.
 */
export async function withLeaderLock(
  prisma: PrismaService,
  name: string,
  pass: () => Promise<unknown>,
): Promise<boolean> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${'job:' + name})) AS ok`;
        if (!rows[0]?.ok) return false;
        await pass();
        return true;
      },
      { timeout: MAX_PASS_MS, maxWait: 5_000 },
    );
  } catch (err) {
    logger.error(`Job ${name} failed to run`, err as Error);
    return false;
  }
}
