import { z } from 'zod';

/** Sent by the browser after the gateway's checkout succeeds. */
export const verifyPaymentSchema = z.object({
  orderId: z.string().min(1).max(100),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

/**
 * Sent by the browser when Razorpay sends the payer back from a Payment Link page. These are the
 * query parameters Razorpay adds to the callback URL; the signature is checked server-side.
 */
export const verifyLinkSchema = z.object({
  linkId: z.string().min(1).max(100),
  referenceId: z.string().max(100),
  status: z.string().min(1).max(40),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});
export type VerifyLinkInput = z.infer<typeof verifyLinkSchema>;

export const fakeCompleteSchema = z.object({ orderId: z.string().min(1).max(100) });
export type FakeCompleteInput = z.infer<typeof fakeCompleteSchema>;

/**
 * Publishing: students pay (no body) or the trainer pays for a fixed list of students (each email
 * is one seat, bought together with the publish fee).
 */
export const publishOrderSchema = z.object({
  studentEmails: z
    .array(z.string().trim().toLowerCase().email('Enter valid email addresses'))
    .max(200, 'At most 200 students per exam')
    .optional(),
});
export type PublishOrderInput = z.infer<typeof publishOrderSchema>;

export interface PublishOrderDto {
  provider: 'fake' | 'razorpay';
  orderId: string;
  amountPaise: number;
  currency: string;
  /** Razorpay public key id for Checkout (null for the fake provider). */
  keyId: string | null;
  description: string;
  /**
   * Set when payments go through a Razorpay Payment Link instead of the in-page Checkout: the
   * browser sends the payer to this page, and Razorpay sends them back to /payment-return/.
   */
  paymentUrl?: string;
}

export interface PublishResultDto {
  exam: { id: string; status: string; code: string | null };
  /** Set when the payment was a student join fee. */
  enrollmentId?: string;
  receiptNo: string;
  /** Where the app should go next (set after a Payment Link return). */
  next?: string;
}

export function formatReceiptNo(n: number): string {
  return `PRK-R-${String(n).padStart(6, '0')}`;
}
