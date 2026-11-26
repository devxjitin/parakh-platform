import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatReceiptNo, type MyPaymentDto, type MyReceiptDto } from '@parakh/shared';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f-]{36}$/i;

const include = {
  exam: { select: { title: true, status: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof include }>;

const describe = (p: PaymentRow) =>
  p.purpose === 'EXAM_CREATION' ? 'Exam creation fee' : 'Exam fee';

/** A user's own payments and receipts. */
@Injectable()
export class MyPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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
      note: 'This is a payment receipt, not a GST tax invoice. NandiVex Technologies is not registered under GST, so no GST is charged.',
    };
  }
}
