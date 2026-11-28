import type { PublishOrderDto, PublishResultDto } from '@parakh/shared';
import { api } from './api';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckoutScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export interface CheckoutOutcome {
  /** The payment was confirmed by the server. */
  result: PublishResultDto | null;
  /** True for the simulated gateway, so the page can say no money moved. */
  simulated: boolean;
}

/**
 * Pays for an order with whichever gateway the server is using, then has the server verify it.
 * Resolves with `result: null` if the student closed the payment window.
 */
export async function runCheckout(
  order: PublishOrderDto,
  prefill: { name: string; email: string },
): Promise<CheckoutOutcome> {
  const verify = (p: { orderId: string; paymentId: string; signature: string }) =>
    api<PublishResultDto>('/payments/verify', { method: 'POST', body: p });

  if (order.provider === 'fake') {
    const done = await api<{ orderId: string; paymentId: string; signature: string }>(
      '/payments/fake/complete',
      { method: 'POST', body: { orderId: order.orderId } },
    );
    return { result: await verify(done), simulated: true };
  }

  // Payment Link flow: pay on Razorpay's own page, which sends the payer back to /payment-return/.
  if (order.paymentUrl) {
    window.location.assign(order.paymentUrl);
    // The page is leaving; nothing more happens here.
    return new Promise<CheckoutOutcome>(() => {});
  }

  if (!(await loadCheckoutScript()) || !window.Razorpay) {
    throw new Error('Could not load the payment window. Check your connection and try again.');
  }
  const Razorpay = window.Razorpay;
  return new Promise<CheckoutOutcome>((resolve, reject) => {
    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'NandiRank by NandiVex Technologies',
      description: order.description,
      prefill,
      handler: (r: RazorpaySuccess) => {
        verify({
          orderId: r.razorpay_order_id,
          paymentId: r.razorpay_payment_id,
          signature: r.razorpay_signature,
        })
          .then((result) => resolve({ result, simulated: false }))
          .catch(reject);
      },
      modal: { ondismiss: () => resolve({ result: null, simulated: false }) },
    });
    checkout.open();
  });
}
