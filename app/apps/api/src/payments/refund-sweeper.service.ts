import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './provider';

/** A PENDING_REFUND payment is only picked up after this long, so a live request can finish first. */
export const REFUND_STALE_MS = 2 * 60_000;

/**
 * Every minute, finishes refunds that were claimed (PENDING_REFUND) but never completed, for
 * example because the server stopped between the gateway call and the ledger write, or the
 * gateway did not answer. It first asks the gateway whether the refund already exists, so the
 * customer is never refunded twice. Each payment is leased with a conditional update, so several
 * servers can run it safely.
 */
@Injectable()
export class RefundSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundSweeperService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (this.env.SWEEP_JOBS_POLL !== 'on') return;
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many refunds were completed. */
  async sweep(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const stuck = await this.prisma.payment.findMany({
        where: {
          status: 'PENDING_REFUND',
          providerPaymentId: { not: null },
          refundedAt: { lt: new Date(now.getTime() - REFUND_STALE_MS) },
        },
        orderBy: { refundedAt: 'asc' },
        take: 50,
      });
      let done = 0;
      for (const p of stuck) {
        // Lease: only the call that moves refundedAt forward may work on this payment.
        const leased = await this.prisma.payment.updateMany({
          where: { id: p.id, status: 'PENDING_REFUND', refundedAt: p.refundedAt },
          data: { refundedAt: now },
        });
        if (leased.count === 0) continue;
        try {
          let refundId = await this.payments.findRefundSafely(p.providerPaymentId!);
          if (!refundId) {
            refundId = (await this.provider.refund(p.providerPaymentId!, p.amountPaise)).refundId;
          }
          if (await this.payments.finishRefund(p.id, refundId)) done++;
        } catch (err) {
          // Stays PENDING_REFUND; tried again next time and listed in the daily reconciliation.
          this.logger.error(`Could not finish refund for payment ${p.id}`, err as Error);
        }
      }
      return done;
    } catch (err) {
      this.logger.error('Refund sweep failed', err as Error);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
