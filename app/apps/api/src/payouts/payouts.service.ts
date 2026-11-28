import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ExaminerProfile, Payout, Prisma } from '@prisma/client';
import {
  ACCOUNTS,
  maskAccount,
  payoutLines,
  type AdminPayableRow,
  type DirectPayoutInput,
  type EarningsDto,
  type EarningsExamRow,
  type PayoutDetailsDto,
  type PayoutDetailsInput,
  type PayPayoutInput,
  type PayoutDto,
  type RejectPayoutInput,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { decryptText, encryptText } from '../common/crypto';
import { ENV, Env } from '../config/env';
import { LedgerService } from '../ledger/ledger.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f-]{36}$/i;

const toDto = (p: Payout): PayoutDto => ({
  id: p.id,
  amountPaise: p.amountPaise,
  status: p.status,
  method: p.method,
  destination: p.destination,
  utr: p.utr,
  note: p.note,
  requestedAt: p.requestedAt.toISOString(),
  paidAt: p.paidAt?.toISOString() ?? null,
});

/** The manual payout workflow (admin only). NandiVex pays by UPI/bank, then records the UTR. */
@Injectable()
export class PayoutsService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    @Inject(ENV) env: Env,
  ) {
    this.secret = env.DATA_ENCRYPTION_KEY ?? env.OTP_SECRET;
  }

  // ------------------------------------------------------------ payout details

  /** What a payout record keeps: enough to see where it went, never the full account number. */
  private snapshot(p: ExaminerProfile): string | null {
    if (p.payoutMethod === 'UPI') return p.upiId;
    if (p.payoutMethod === 'BANK') {
      return `${p.bankAccountName} · ${p.ifsc} · ${maskAccount(p.bankAccountLast4)}`;
    }
    return null;
  }

  /** The full destination, for the admin who is about to pay it. */
  private fullDestination(p: ExaminerProfile | null): string | null {
    if (!p?.payoutMethod) return null;
    if (p.payoutMethod === 'UPI') return p.upiId;
    let number = '';
    try {
      number = p.bankAccountNoEnc ? decryptText(p.bankAccountNoEnc, this.secret) : '';
    } catch {
      // The encryption key changed since this was saved: ask the trainer to enter it again.
      return `${p.bankAccountName} · account number unreadable (ask the trainer to re-enter it)`;
    }
    return `${p.bankAccountName} · A/c ${number} · IFSC ${p.ifsc}`;
  }

  private detailsDto(p: ExaminerProfile | null): PayoutDetailsDto {
    const bank = p?.payoutMethod === 'BANK';
    return {
      method: p?.payoutMethod ?? null,
      upiId: p?.payoutMethod === 'UPI' ? p.upiId : null,
      accountName: bank ? p.bankAccountName : null,
      accountMasked: bank ? maskAccount(p.bankAccountLast4) : null,
      ifsc: bank ? p.ifsc : null,
      verifiedAt: p?.payoutDetailsVerifiedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------ trainer

  /**
   * A trainer's own money screen. The balances come from the same ledger function the admin
   * payout screen uses, so the two can never show different numbers.
   */
  async earnings(user: AuthUser): Promise<EarningsDto> {
    const [balances, profile, payouts, sums] = await Promise.all([
      this.ledger.balances(user.id),
      this.prisma.examinerProfile.findUnique({ where: { userId: user.id } }),
      this.prisma.payout.findMany({
        where: { examinerId: user.id },
        orderBy: { requestedAt: 'desc' },
        take: 50,
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['examId'],
        where: { account: ACCOUNTS.examiner(user.id), type: { not: 'PAYOUT' } },
        _sum: { amountPaise: true },
      }),
    ]);
    const examIds = sums.map((s) => s.examId).filter((x): x is string => !!x);
    const [exams, joins] = await Promise.all([
      this.prisma.exam.findMany({
        where: { id: { in: examIds } },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.groupBy({
        by: ['examId'],
        where: { examId: { in: examIds }, purpose: 'EXAM_JOIN', status: 'CAPTURED' },
        _count: { _all: true },
        _sum: { amountPaise: true },
      }),
    ]);
    const share = new Map(sums.map((s) => [s.examId, s._sum.amountPaise ?? 0]));
    const joined = new Map(joins.map((j) => [j.examId, j]));
    const rows: EarningsExamRow[] = exams.map((e) => ({
      examId: e.id,
      title: e.title,
      status: e.status,
      joins: joined.get(e.id)?._count._all ?? 0,
      grossPaise: joined.get(e.id)?._sum.amountPaise ?? 0,
      sharePaise: share.get(e.id) ?? 0,
      state: e.status === 'RESULTS_FINAL' ? 'PAYABLE' : 'ACCRUED',
    }));
    return {
      balances,
      exams: rows,
      payouts: payouts.map(toDto),
      details: this.detailsDto(profile),
    };
  }

  /** Saves where the trainer wants to be paid. Any change must be re-verified by NandiVex. */
  async saveDetails(user: AuthUser, input: PayoutDetailsInput): Promise<PayoutDetailsDto> {
    const common = { payoutDetailsUpdatedAt: new Date(), payoutDetailsVerifiedAt: null };
    const data =
      input.method === 'UPI'
        ? {
            ...common,
            payoutMethod: 'UPI' as const,
            upiId: input.upiId,
            bankAccountName: null,
            bankAccountNoEnc: null,
            bankAccountLast4: null,
            ifsc: null,
          }
        : {
            ...common,
            payoutMethod: 'BANK' as const,
            upiId: null,
            bankAccountName: input.accountName,
            bankAccountNoEnc: encryptText(input.accountNumber, this.secret),
            bankAccountLast4: input.accountNumber.slice(-4),
            ifsc: input.ifsc,
          };
    const saved = await this.prisma.examinerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    // Never log the account number or UPI id; only that, and how, the details changed.
    await this.audit.log({
      actorId: user.id,
      action: 'payout.details.update',
      entity: 'User',
      entityId: user.id,
      meta: { method: input.method },
    });
    return this.detailsDto(saved);
  }

  /** Asks NandiVex to pay everything that is payable now. One open request at a time. */
  async requestPayout(user: AuthUser): Promise<PayoutDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.id);
      const profile = await tx.examinerProfile.findUnique({ where: { userId: user.id } });
      if (!profile?.payoutMethod) throw new ConflictException('Add your payout details first');
      const open = await tx.payout.findFirst({
        where: { examinerId: user.id, status: 'REQUESTED' },
      });
      if (open) throw new ConflictException('You already have a payout request waiting');
      const balances = await this.ledger.balances(user.id, tx);
      if (balances.payablePaise <= 0 || balances.payablePaise < balances.minPayoutPaise) {
        throw new ConflictException(
          `You can ask for a payout once at least INR ${(Math.max(balances.minPayoutPaise, 1) / 100).toFixed(2)} is payable`,
        );
      }
      return tx.payout.create({
        data: {
          examinerId: user.id,
          amountPaise: balances.payablePaise,
          method: profile.payoutMethod,
          destination: this.snapshot(profile),
        },
      });
    });
    await this.audit.log({
      actorId: user.id,
      action: 'payout.request',
      entity: 'Payout',
      entityId: created.id,
      meta: { amountPaise: created.amountPaise },
    });
    return toDto(created);
  }

  async statement(user: AuthUser, payoutId: string): Promise<{ filename: string; body: string }> {
    const payout = UUID.test(payoutId)
      ? await this.prisma.payout.findFirst({
          where: { id: payoutId, ...(user.role === 'ADMIN' ? {} : { examinerId: user.id }) },
          include: { examiner: { select: { name: true, email: true } } },
        })
      : null;
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'PAID') throw new ConflictException('This payout has not been paid yet');

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        account: ACCOUNTS.examiner(payout.examinerId),
        type: { not: 'PAYOUT' },
        ...(payout.periodFrom || payout.periodTo
          ? {
              createdAt: {
                ...(payout.periodFrom ? { gt: payout.periodFrom } : {}),
                ...(payout.periodTo ? { lte: payout.periodTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const exams = await this.prisma.exam.findMany({
      where: {
        id: { in: [...new Set(entries.map((e) => e.examId).filter((x): x is string => !!x))] },
      },
      select: { id: true, title: true },
    });
    const title = new Map(exams.map((e) => [e.id, e.title]));
    const cell = (v: string | number | null) => {
      let s = v === null ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const inr = (p: number) => (p / 100).toFixed(2);
    const lines = [
      ['NandiRank payout statement'],
      ['Trainer', payout.examiner.name],
      ['Email', payout.examiner.email],
      ['Payout id', payout.id],
      ['Amount paid (INR)', inr(payout.amountPaise)],
      ['Paid to', payout.destination],
      ['Reference (UTR)', payout.utr],
      ['Paid on', payout.paidAt?.toISOString() ?? null],
      [],
      ['Earnings recorded in this period'],
      ['Date', 'Exam', 'Type', 'Amount (INR)'],
      ...entries.map((e) => [
        e.createdAt.toISOString().slice(0, 10),
        e.examId ? (title.get(e.examId) ?? '') : '',
        e.type === 'REFUND' ? 'Refund (deducted)' : 'Student fee share',
        inr(e.amountPaise),
      ]),
      ['', '', 'Total', inr(entries.reduce((s, e) => s + e.amountPaise, 0))],
    ];
    return {
      filename: `payout-${payout.id.slice(0, 8)}-statement.csv`,
      body:
        lines.map((r) => r.map((c) => cell(c as string | number | null)).join(',')).join('\r\n') +
        '\r\n',
    };
  }

  // -------------------------------------------------------------------- admin

  /** Trainers who are owed money or have asked for it. */
  async payable(): Promise<AdminPayableRow[]> {
    const accounts = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      where: { account: { startsWith: 'EXAMINER:' } },
    });
    const ids = accounts
      .map((a) => a.account.slice('EXAMINER:'.length))
      .filter((i) => UUID.test(i));
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true, examinerProfile: true },
    });
    const rows: AdminPayableRow[] = [];
    for (const u of users) {
      const balances = await this.ledger.balances(u.id);
      const request = await this.prisma.payout.findFirst({
        where: { examinerId: u.id, status: 'REQUESTED' },
      });
      if (balances.payablePaise <= 0 && !request) continue;
      rows.push({
        examinerId: u.id,
        name: u.name,
        email: u.email,
        balances,
        request: request ? toDto(request) : null,
        destination: this.fullDestination(u.examinerProfile),
        method: u.examinerProfile?.payoutMethod ?? null,
        detailsVerified: Boolean(u.examinerProfile?.payoutDetailsVerifiedAt),
      });
    }
    return rows.sort(
      (a, b) =>
        Number(Boolean(b.request)) - Number(Boolean(a.request)) ||
        b.balances.payablePaise - a.balances.payablePaise,
    );
  }

  async list(status?: 'REQUESTED' | 'PAID' | 'REJECTED') {
    const rows = await this.prisma.payout.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: { examiner: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({
      ...toDto(r),
      examinerName: r.examiner.name,
      examinerEmail: r.examiner.email,
    }));
  }

  async verifyDetails(admin: AuthUser, examinerId: string): Promise<{ verified: true }> {
    const profile = UUID.test(examinerId)
      ? await this.prisma.examinerProfile.findUnique({ where: { userId: examinerId } })
      : null;
    if (!profile?.payoutMethod) throw new NotFoundException('This trainer has no payout details');
    await this.prisma.examinerProfile.update({
      where: { userId: examinerId },
      data: { payoutDetailsVerifiedAt: new Date() },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'payout.details.verify',
      entity: 'User',
      entityId: examinerId,
    });
    return { verified: true };
  }

  /** Records that NandiVex has sent the money (UPI/bank) and books it in the ledger. */
  async pay(admin: AuthUser, payoutId: string, input: PayPayoutInput): Promise<PayoutDto> {
    const payout = UUID.test(payoutId)
      ? await this.prisma.payout.findUnique({ where: { id: payoutId } })
      : null;
    if (!payout) throw new NotFoundException('Payout not found');
    const done = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, payout.examinerId);
      const fresh = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
      if (fresh.status !== 'REQUESTED') {
        throw new ConflictException(`This payout is already ${fresh.status.toLowerCase()}`);
      }
      return this.settle(tx, admin, fresh, input);
    });
    await this.afterPaid(done);
    return toDto(done);
  }

  /** Pays a trainer without a request (for example on the scheduled payout day). */
  async direct(admin: AuthUser, input: DirectPayoutInput): Promise<PayoutDto> {
    const done = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, input.examinerId);
      const open = await tx.payout.findFirst({
        where: { examinerId: input.examinerId, status: 'REQUESTED' },
      });
      if (open) throw new ConflictException("Pay or reject the trainer's open request first");
      const created = await tx.payout.create({
        data: { examinerId: input.examinerId, amountPaise: input.amountPaise },
      });
      return this.settle(tx, admin, created, input);
    });
    await this.afterPaid(done);
    return toDto(done);
  }

  async reject(admin: AuthUser, payoutId: string, input: RejectPayoutInput): Promise<PayoutDto> {
    const payout = UUID.test(payoutId)
      ? await this.prisma.payout.findUnique({ where: { id: payoutId } })
      : null;
    if (!payout) throw new NotFoundException('Payout not found');
    const claimed = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: 'REQUESTED' },
      data: { status: 'REJECTED', note: input.note, paidById: admin.id },
    });
    if (claimed.count === 0) throw new ConflictException('This payout is no longer waiting');
    await this.audit.log({
      actorId: admin.id,
      action: 'payout.reject',
      entity: 'Payout',
      entityId: payout.id,
      meta: { note: input.note },
    });
    return toDto(await this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }));
  }

  // ------------------------------------------------------------------ helpers

  /** One payout decision per trainer at a time, so two admins cannot pay the same money twice. */
  private async lock(tx: Prisma.TransactionClient, examinerId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + examinerId}))`;
  }

  private async settle(
    tx: Prisma.TransactionClient,
    admin: AuthUser,
    payout: Payout,
    input: { utr: string; note?: string | null },
  ): Promise<Payout> {
    const profile = await tx.examinerProfile.findUnique({ where: { userId: payout.examinerId } });
    // Money only goes to details an admin has verified. Changing the details resets this, so a
    // swapped account can never be paid by habit.
    if (!profile?.payoutMethod || !profile.payoutDetailsVerifiedAt) {
      throw new ConflictException(
        "Verify this trainer's payout details before recording a payment",
      );
    }
    // The amount must still be covered by released money, after the other open requests.
    const balances = await this.ledger.balances(payout.examinerId, tx);
    const otherPending =
      balances.pendingPaise - (payout.status === 'REQUESTED' ? payout.amountPaise : 0);
    const coverable = Math.max(0, balances.netPaise - otherPending);
    if (payout.amountPaise > coverable) {
      throw new ConflictException(
        `Only INR ${(coverable / 100).toFixed(2)} is payable to this trainer right now`,
      );
    }
    const lastPaid = await tx.payout.findFirst({
      where: { examinerId: payout.examinerId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    });
    const now = new Date();
    const paid = await tx.payout.update({
      where: { id: payout.id },
      data: {
        status: 'PAID',
        utr: input.utr,
        note: input.note ?? payout.note,
        method: profile?.payoutMethod ?? null,
        destination: profile ? this.snapshot(profile) : null,
        paidAt: now,
        paidById: admin.id,
        periodFrom: lastPaid?.paidAt ?? null,
        periodTo: now,
      },
    });
    await this.ledger.post(tx, payoutLines(paid.amountPaise, paid.examinerId), {
      type: 'PAYOUT',
      payoutId: paid.id,
    });
    return paid;
  }

  private async afterPaid(p: Payout) {
    await this.audit.log({
      actorId: p.paidById,
      action: 'payout.paid',
      entity: 'Payout',
      entityId: p.id,
      meta: { amountPaise: p.amountPaise, utr: p.utr },
    });
    const user = await this.prisma.user.findUnique({ where: { id: p.examinerId } });
    if (user) {
      await this.mail.sendPayoutPaid(user.email, user.name, {
        amountPaise: p.amountPaise,
        utr: p.utr ?? '',
        destination: p.destination ?? '',
        paidAt: p.paidAt ?? new Date(),
      });
    }
  }
}
