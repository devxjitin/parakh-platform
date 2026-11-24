import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

type Db = PrismaClient | Prisma.TransactionClient;

/** Paid seats nobody has used yet. They still count against the exam's student limit. */
export const outstandingSeats = (db: Db, examId: string): Promise<number> =>
  db.seat.count({ where: { redeemedAt: null, pack: { examId } } });

/** An unguessable code for a redeem link (160 bits). */
export const seatToken = (): string => randomBytes(20).toString('base64url');
