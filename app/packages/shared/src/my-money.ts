import { z } from 'zod';

/** What every signed-in user can see about their own payments, plus student refund requests. */

export const refundRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us briefly why').max(300),
});
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;

export const rejectRefundRequestSchema = z.object({
  note: z.string().trim().min(3, 'Give the student a reason').max(300),
});
export type RejectRefundRequestInput = z.infer<typeof rejectRefundRequestSchema>;

export type RefundRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED';

export interface MyRefundRequestDto {
  status: RefundRequestStatus;
  reason: string;
  decisionNote: string | null;
}

export interface MyPaymentDto {
  id: string;
  receiptNo: string;
  purpose: 'EXAM_CREATION' | 'EXAM_JOIN' | 'SEAT_PACK';
  /** Plain-words line for the receipt, e.g. "Exam fee" or "3 sponsored seats". */
  description: string;
  status: 'CAPTURED' | 'PENDING_REFUND' | 'REFUNDED';
  amountPaise: number;
  examTitle: string | null;
  quantity: number;
  capturedAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  refundRequest: MyRefundRequestDto | null;
  /** A student may ask for a refund until they start the exam. */
  canRequestRefund: boolean;
}

export interface MyReceiptDto extends MyPaymentDto {
  payerName: string;
  payerEmail: string;
  /** The payment gateway's reference, for the user's own bank query. */
  gatewayReference: string | null;
  /** Shown on the receipt: NandiVex is not GST-registered, so this is not a tax invoice. */
  note: string;
}

export interface AdminRefundRequestRow {
  id: string;
  paymentId: string;
  receiptNo: string;
  amountPaise: number;
  studentName: string;
  studentEmail: string;
  examTitle: string | null;
  reason: string;
  status: RefundRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  /** False when the student has since started the exam, so approving would be refused. */
  stillEligible: boolean;
}
