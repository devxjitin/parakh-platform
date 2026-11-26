/** What every signed-in user can see about their own payments. */

export interface MyPaymentDto {
  id: string;
  receiptNo: string;
  purpose: 'EXAM_CREATION' | 'EXAM_JOIN';
  /** Plain-words line for the receipt, e.g. "Exam fee". */
  description: string;
  status: 'CAPTURED' | 'PENDING_REFUND' | 'REFUNDED';
  amountPaise: number;
  examTitle: string | null;
  quantity: number;
  capturedAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
}

export interface MyReceiptDto extends MyPaymentDto {
  payerName: string;
  payerEmail: string;
  /** The payment gateway's reference, for the user's own bank query. */
  gatewayReference: string | null;
  /** Shown on the receipt: NandiVex is not GST-registered, so this is not a tax invoice. */
  note: string;
}
