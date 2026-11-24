import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  formatReceiptNo,
  type AdminRefundRequestRow,
  type MyPaymentDto,
  type MyReceiptDto,
  type RefundRequestStatus,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

const UUID = /^[0-9a-f-]{36}$/i;

const include = {
  exam: { select: { title: true, status: true } },
  enrollment: { select: { attempt: { select: { id: true } } } },
  refundRequest: true,
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof include }>;

const describe = (p: PaymentRow) =>
  p.purpose === 'EXAM_CREATION'
    ? 'Exam creation fee'
    : p.purpose === 'SEAT_PACK'
      ? `${p.quantity} sponsored seat${p.quantity === 1 ? '' : 's'}`
      : 'Exam fee';

/** Why a student's refund request cannot be made or approved right now; null if it can. */
function refundBlocker(p: PaymentRow): string | null {
  if (p.purpose !== 'EXAM_JOIN') return 'Only an exam fee can be refunded here';
  if (p.status !== 'CAPTURED') return 'This payment is not an active paid seat';
  if (!p.enrollment) return 'This payment has no seat to cancel';
  if (p.enrollment.attempt)
    return 'You have already started this exam, so the fee is not refundable';
  if (p.exam?.status === 'RESULTS_FINAL') return 'Results for this exam are already published';
  return null;
}

/** A user's own payments and receipts, student refund requests, and the admin queue for them. */
@Injectable()
export class MyPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private dto(p: PaymentRow): MyPaymentDto {
    return {
      id: p.id,
      receiptNo: formatReceiptNo(p.receiptNo),
      purpose: p.purpose,
      description: describe(p),
      status: p.status as 'CAPTURED' | 'PENDING_REFUND' | 'REFUNDED',
      amountPaise: p.amountPaise,
      examTitle: p.exam?.title ?? null,
      quantity: p.quantity,
      capturedAt: p.capturedAt?.toISOString() ?? null,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      refundReason: p.refundReason,
      refundRequest: p.refundRequest
        ? {
            status: p.refundRequest.status,
            reason: p.refundRequest.reason,
            decisionNote: p.refundRequest.decisionNote,
          }
        : null,
      // Students can no longer ask for a refund (see requestRefund).
      canRequestRefund: false,
    };
  }

  private async owned(user: AuthUser, id: string): Promise<PaymentRow> {
    const payment = UUID.test(id)
      ? await this.prisma.payment.findFirst({
          where: {
            id,
            userId: user.id,
            status: { in: ['CAPTURED', 'PENDING_REFUND', 'REFUNDED'] },
          },
          include,
        })
      : null;
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async list(user: AuthUser): Promise<MyPaymentDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: { userId: user.id, status: { in: ['CAPTURED', 'PENDING_REFUND', 'REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include,
    });
    return rows.map((r) => this.dto(r));
  }

  async receipt(user: AuthUser, id: string): Promise<MyReceiptDto> {
    const p = await this.owned(user, id);
    const payer = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, email: true },
    });
    return {
      ...this.dto(p),
      payerName: payer.name,
      payerEmail: payer.email,
      gatewayReference: p.providerPaymentId,
      note: 'This is a payment receipt, not a GST tax invoice. Amounts include applicable taxes.',
    };
  }

  // ------------------------------------------------------------ student request

  /**
   * Owner policy (2026-11-22): a fee is not refundable once paid, so students can no longer ask.
   * Existing requests can still be decided in the admin queue; refunds for charges made by
   * mistake go through an admin.
   */
  async requestRefund(user: AuthUser, id: string, _reason: string): Promise<MyPaymentDto> {
    await this.owned(user, id);
    throw new ConflictException(
      'Fees are not refundable once paid. See the refund policy, or contact us if you were charged by mistake.',
    );
  }

  // ---------------------------------------------------------------------- admin

  async listRequests(status?: string): Promise<AdminRefundRequestRow[]> {
    const wanted = (['REQUESTED', 'APPROVED', 'REJECTED'] as const).find((s) => s === status);
    const rows = await this.prisma.refundRequest.findMany({
      where: wanted ? { status: wanted } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        payment: { include: { ...include, user: { select: { name: true, email: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      receiptNo: formatReceiptNo(r.payment.receiptNo),
      amountPaise: r.payment.amountPaise,
      studentName: r.payment.user.name,
      studentEmail: r.payment.user.email,
      examTitle: r.payment.exam?.title ?? null,
      reason: r.reason,
      status: r.status as RefundRequestStatus,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      stillEligible:
        r.status === 'REQUESTED' && refundBlocker({ ...r.payment, refundRequest: null }) === null,
    }));
  }

  /** Approving is the ordinary admin refund; the request is closed only after it succeeds. */
  async approve(admin: AuthUser, id: string): Promise<{ refunded: true }> {
    const request = await this.open(id);
    await this.payments.refund(admin, request.paymentId, `Student request: ${request.reason}`);
    await this.prisma.refundRequest.updateMany({
      where: { id: request.id, status: 'REQUESTED' },
      data: { status: 'APPROVED', decidedById: admin.id, decidedAt: new Date() },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'refund.request.approve',
      entity: 'RefundRequest',
      entityId: request.id,
    });
    return { refunded: true };
  }

  async reject(admin: AuthUser, id: string, note: string): Promise<{ rejected: true }> {
    const request = await this.open(id);
    const claimed = await this.prisma.refundRequest.updateMany({
      where: { id: request.id, status: 'REQUESTED' },
      data: {
        status: 'REJECTED',
        decidedById: admin.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count === 0) throw new ConflictException('This request was already decided');
    await this.audit.log({
      actorId: admin.id,
      action: 'refund.request.reject',
      entity: 'RefundRequest',
      entityId: request.id,
      meta: { note },
    });
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: request.paymentId },
      include: { user: { select: { name: true, email: true } }, exam: { select: { title: true } } },
    });
    await this.mail.sendRefundRequestRejected(payment.user.email, payment.user.name, {
      receiptNo: formatReceiptNo(payment.receiptNo),
      examTitle: payment.exam?.title ?? 'an exam',
      note,
    });
    return { rejected: true };
  }

  private async open(id: string) {
    const request = UUID.test(id)
      ? await this.prisma.refundRequest.findUnique({ where: { id } })
      : null;
    if (!request) throw new NotFoundException('Refund request not found');
    if (request.status !== 'REQUESTED') {
      throw new ConflictException('This request was already decided');
    }
    return request;
  }
}
