import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { formatReceiptNo } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './provider';

const IST_OFFSET_MS = 5.5 * 3_600_000;
/** A refund still PENDING_REFUND after this long needs a human to look at it. */
export const STUCK_REFUND_MS = 60 * 60_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type MismatchKind =
  | 'CAPTURED_AT_GATEWAY_NOT_IN_DB'
  | 'CAPTURED_IN_DB_NOT_AT_GATEWAY'
  | 'AMOUNT_DIFFERS'
  | 'REFUNDED_AT_GATEWAY_NOT_IN_DB'
  | 'REFUNDED_IN_DB_NOT_AT_GATEWAY'
  | 'STUCK_PENDING_REFUND';

export interface Mismatch {
  kind: MismatchKind;
  providerPaymentId: string | null;
  receiptNo: string | null;
  detail: string;
}

export interface ReconciliationReport {
  /** The IST calendar day checked, YYYY-MM-DD. */
  day: string;
  /** Set when nothing could be compared (the fake provider); then the counts are zero. */
  skipped: string | null;
  gatewayCount: number;
  databaseCount: number;
  matched: number;
  mismatches: Mismatch[];
}

/** The IST day before `now`, as YYYY-MM-DD. */
export function previousIstDay(now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS - 24 * 3_600_000).toISOString().slice(0, 10);
}

/** Start and end (exclusive) of an IST calendar day. */
export function istDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 24 * 3_600_000) };
}

const rupees = (paise: number) => '₹' + (paise / 100).toFixed(2);

/**
 * Compares everything Razorpay saw on one IST day with the payments in our database and lists
 * the differences. Runs once a day on its own (for the previous day) and on demand from Admin.
 * It only reads and reports; it never changes a payment.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.SWEEP_JOBS_POLL !== 'on') return;
    this.timer = setInterval(() => void this.runDaily(), 30 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reconciles yesterday (IST) once, from 03:00 IST on. Returns the report, or null if not due. */
  async runDaily(now = new Date()): Promise<ReconciliationReport | null> {
    if (this.running) return null;
    const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
    if (istHour < 3) return null;
    this.running = true;
    try {
      const day = previousIstDay(now);
      const already = await this.prisma.auditLog.findFirst({
        where: { action: 'payment.reconciliation', entityId: day },
        select: { id: true },
      });
      if (already) return null;
      const report = await this.reconcile(day);
      await this.audit.log({
        action: 'payment.reconciliation',
        entity: 'Reconciliation',
        entityId: day,
        meta: {
          gatewayCount: report.gatewayCount,
          databaseCount: report.databaseCount,
          matched: report.matched,
          mismatches: report.mismatches.length,
          skipped: report.skipped,
        },
      });
      if (report.mismatches.length > 0) {
        const admins = await this.prisma.user.findMany({
          where: { role: 'ADMIN', status: 'ACTIVE' },
          select: { email: true },
        });
        const lines = report.mismatches.map(
          (m) => `${m.receiptNo ?? m.providerPaymentId}: ${m.detail}`,
        );
        for (const a of admins) {
          await this.mail.sendReconciliationReport(a.email, { day, lines });
        }
      }
      return report;
    } catch (err) {
      this.logger.error('Daily reconciliation failed', err as Error);
      return null;
    } finally {
      this.running = false;
    }
  }

  async reconcile(day: string, now = new Date()): Promise<ReconciliationReport> {
    if (!DAY_KEY.test(day) || Number.isNaN(istDayRange(day).from.getTime())) {
      throw new RangeError('day must be YYYY-MM-DD');
    }
    const { from, to } = istDayRange(day);
    const gateway = await this.provider.listPayments(from, to);
    if (gateway === null) {
      return {
        day,
        skipped: 'The fake payment provider has nothing to compare with.',
        gatewayCount: 0,
        databaseCount: 0,
        matched: 0,
        mismatches: [],
      };
    }

    const mismatches: Mismatch[] = [];
    const db = await this.prisma.payment.findMany({
      where: { provider: this.provider.name, createdAt: { gte: from, lt: to } },
    });
    const byGatewayId = new Map(gateway.map((g) => [g.paymentId, g]));
    const byProviderPaymentId = new Map(
      db.filter((p) => p.providerPaymentId).map((p) => [p.providerPaymentId!, p]),
    );
    const byOrderId = new Map(db.map((p) => [p.providerOrderId, p]));
    const paidInDb = ['CAPTURED', 'PENDING_REFUND', 'REFUNDED'];
    let matched = 0;

    for (const g of gateway) {
      if (g.status !== 'captured' && g.status !== 'refunded') continue;
      const row =
        byProviderPaymentId.get(g.paymentId) ?? (g.orderId ? byOrderId.get(g.orderId) : undefined);
      const receiptNo = row ? formatReceiptNo(row.receiptNo) : null;
      if (!row || !paidInDb.includes(row.status)) {
        mismatches.push({
          kind: 'CAPTURED_AT_GATEWAY_NOT_IN_DB',
          providerPaymentId: g.paymentId,
          receiptNo,
          detail: `Razorpay ${g.status} ${rupees(g.amountPaise)} but the database has ${row ? row.status : 'no payment'}`,
        });
        continue;
      }
      if (row.amountPaise !== g.amountPaise) {
        mismatches.push({
          kind: 'AMOUNT_DIFFERS',
          providerPaymentId: g.paymentId,
          receiptNo,
          detail: `Razorpay ${rupees(g.amountPaise)} but the database ${rupees(row.amountPaise)}`,
        });
        continue;
      }
      const refundedAtGateway = g.status === 'refunded' || g.amountRefundedPaise >= g.amountPaise;
      if (refundedAtGateway && row.status === 'CAPTURED') {
        mismatches.push({
          kind: 'REFUNDED_AT_GATEWAY_NOT_IN_DB',
          providerPaymentId: g.paymentId,
          receiptNo,
          detail: 'Razorpay shows it refunded but the database still has it as paid',
        });
        continue;
      }
      if (!refundedAtGateway && row.status === 'REFUNDED') {
        mismatches.push({
          kind: 'REFUNDED_IN_DB_NOT_AT_GATEWAY',
          providerPaymentId: g.paymentId,
          receiptNo,
          detail: 'The database says refunded but Razorpay does not show a full refund',
        });
        continue;
      }
      matched++;
    }

    for (const p of db) {
      if (!p.providerPaymentId || !paidInDb.includes(p.status)) continue;
      const g = byGatewayId.get(p.providerPaymentId);
      if (!g || (g.status !== 'captured' && g.status !== 'refunded')) {
        mismatches.push({
          kind: 'CAPTURED_IN_DB_NOT_AT_GATEWAY',
          providerPaymentId: p.providerPaymentId,
          receiptNo: formatReceiptNo(p.receiptNo),
          detail: `The database has it as ${p.status} but Razorpay has ${g ? g.status : 'no such payment that day'}`,
        });
      }
    }

    // Not tied to the day: any refund that has been stuck for over an hour.
    const stuck = await this.prisma.payment.findMany({
      where: {
        provider: this.provider.name,
        status: 'PENDING_REFUND',
        refundedAt: { lt: new Date(now.getTime() - STUCK_REFUND_MS) },
      },
    });
    for (const p of stuck) {
      mismatches.push({
        kind: 'STUCK_PENDING_REFUND',
        providerPaymentId: p.providerPaymentId,
        receiptNo: formatReceiptNo(p.receiptNo),
        detail: `Refund of ${rupees(p.amountPaise)} has been pending for over an hour`,
      });
    }

    return {
      day,
      skipped: null,
      gatewayCount: gateway.length,
      databaseCount: db.length,
      matched,
      mismatches,
    };
  }
}
