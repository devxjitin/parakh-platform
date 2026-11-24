import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS,
  assertBalanced,
  type BalancesDto,
  type LedgerCheckDto,
  type LedgerLine,
} from '@parakh/shared';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The double-entry ledger. Money only ever moves through `post`, which refuses entries that do
 * not add up to zero, so "where did the money go" always has an exact answer.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Writes one balanced transaction. Call inside the same DB transaction as the event itself. */
  async post(
    db: Db,
    lines: LedgerLine[],
    meta: { type: 'CREDIT' | 'REFUND' | 'PAYOUT'; paymentId?: string; payoutId?: string },
  ): Promise<string> {
    assertBalanced(lines);
    const txnId = randomUUID();
    await db.ledgerEntry.createMany({
      data: lines
        .filter((l) => l.amountPaise !== 0)
        .map((l) => ({
          txnId,
          account: l.account,
          amountPaise: l.amountPaise,
          type: meta.type,
          paymentId: meta.paymentId ?? null,
          payoutId: meta.payoutId ?? null,
          examId: l.examId ?? null,
          note: l.note ?? null,
        })),
    });
    return txnId;
  }

  /**
   * What NandiVex owes a trainer, split into what is still accruing (the exam's results are not
   * published yet, so refunds are still possible) and what can be paid out now.
   */
  async balances(examinerId: string, db: Db = this.prisma): Promise<BalancesDto> {
    const account = ACCOUNTS.examiner(examinerId);
    const sums = await db.ledgerEntry.groupBy({
      by: ['examId', 'type'],
      where: { account },
      _sum: { amountPaise: true },
    });
    const examIds = [...new Set(sums.map((s) => s.examId).filter((x): x is string => !!x))];
    const exams = await db.exam.findMany({
      where: { id: { in: examIds } },
      select: { id: true, status: true },
    });
    const final = new Set(exams.filter((e) => e.status === 'RESULTS_FINAL').map((e) => e.id));

    let accrued = 0;
    let released = 0;
    let paid = 0;
    for (const s of sums) {
      const amount = s._sum.amountPaise ?? 0;
      if (s.type === 'PAYOUT') paid += -amount;
      else if (s.examId && final.has(s.examId)) released += amount;
      else accrued += amount;
    }
    const pending =
      (
        await db.payout.aggregate({
          where: { examinerId, status: 'REQUESTED' },
          _sum: { amountPaise: true },
        })
      )._sum.amountPaise ?? 0;
    const net = released - paid;
    return {
      accruedPaise: accrued,
      netPaise: net,
      payablePaise: Math.max(0, net - pending),
      pendingPaise: pending,
      paidPaise: paid,
      owedBackPaise: Math.max(0, -net),
      minPayoutPaise: (await this.settings.get()).minPayoutPaise,
    };
  }

  /** Proof that the books balance: every transaction and the whole ledger add up to zero. */
  async check(): Promise<LedgerCheckDto> {
    const [total, byTxn, accounts, entries] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ _sum: { amountPaise: true } }),
      this.prisma.ledgerEntry.groupBy({
        by: ['txnId'],
        _sum: { amountPaise: true },
        having: { amountPaise: { _sum: { not: 0 } } },
      }),
      this.prisma.ledgerEntry.groupBy({ by: ['account'], _sum: { amountPaise: true } }),
      this.prisma.ledgerEntry.count(),
    ]);
    const transactions = (await this.prisma.ledgerEntry.groupBy({ by: ['txnId'] })).length;
    const of = (a: string) => accounts.find((x) => x.account === a)?._sum.amountPaise ?? 0;
    const owed = accounts
      .filter((a) => a.account.startsWith('EXAMINER:'))
      .reduce((s, a) => s + (a._sum.amountPaise ?? 0), 0);
    return {
      entries,
      transactions,
      totalPaise: total._sum.amountPaise ?? 0,
      unbalancedTransactions: byTxn.map((t) => t.txnId),
      platformPaise: of(ACCOUNTS.PLATFORM),
      owedToTrainersPaise: owed,
      paidOutPaise: of(ACCOUNTS.PAYOUTS),
      grossCollectedPaise: -of(ACCOUNTS.EXTERNAL),
    };
  }
}
