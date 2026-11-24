import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Env } from '../config/env';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
const RAZORPAY_TIMEOUT_MS = 10_000;

export interface GatewayOrder {
  orderId: string;
}

/** A Razorpay Payment Link: a hosted payment page, used while Checkout is not allowed on our site. */
export interface GatewayLink {
  /** plink_... id; stored as the payment's providerOrderId. */
  linkId: string;
  /** The page the payer opens (rzp.io/...). */
  shortUrl: string;
}

export interface CreateLinkInput {
  amountPaise: number;
  currency: string;
  /** Our unique reference, shown back to us in the callback and the webhook. */
  referenceId: string;
  description: string;
  customer: { name: string; email: string };
  /** Where Razorpay sends the payer after paying. */
  callbackUrl: string;
}

/** A gateway webhook reduced to what we act on. */
export interface WebhookInfo {
  eventId: string;
  type: 'captured' | 'failed' | 'ignored';
  orderId?: string;
  paymentId?: string;
  amountPaise?: number;
  reason?: string;
}

/** A payment as the gateway reports it, for the daily reconciliation. */
export interface GatewayPayment {
  paymentId: string;
  orderId: string | null;
  amountPaise: number;
  /** Razorpay status: created, authorized, captured, refunded or failed. */
  status: string;
  amountRefundedPaise: number;
}

/**
 * A refund call that failed. `definite` means the gateway rejected it (so no money moved);
 * otherwise (timeout, 5xx, network) the refund may or may not have gone through.
 */
export class GatewayRefundError extends Error {
  constructor(
    message: string,
    readonly definite: boolean,
  ) {
    super(message);
  }
}

export interface PaymentProvider {
  readonly name: 'fake' | 'razorpay';
  /** Public key the browser needs for Checkout (null when not applicable). */
  readonly publicKeyId: string | null;
  createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
  }): Promise<GatewayOrder>;
  /** Creates a hosted Payment Link page for one payment. */
  createPaymentLink(input: CreateLinkInput): Promise<GatewayLink>;
  /** An existing Payment Link's page and status (created, paid, expired, cancelled...). */
  getPaymentLink(linkId: string): Promise<{ shortUrl: string; status: string } | null>;
  /** Checks the signature Razorpay adds when it sends the payer back from a Payment Link. */
  verifyLinkSignature(input: {
    linkId: string;
    referenceId: string;
    status: string;
    paymentId: string;
    signature: string;
  }): boolean;
  /** Checks the signature the browser got back from Checkout. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Checks the webhook signature over the exact raw request body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(body: unknown, eventIdHeader: string | undefined): WebhookInfo;
  /** Sends the money back to the customer's card or account. */
  refund(paymentId: string, amountPaise: number): Promise<{ refundId: string }>;
  /** The refund already issued for a payment, if any (lets a retry avoid refunding twice). */
  findRefund(paymentId: string): Promise<{ refundId: string } | null>;
  /**
   * Every payment the gateway created between the two times, or null when the provider cannot
   * be reconciled (the fake one).
   */
  listPayments(from: Date, to: Date): Promise<GatewayPayment[] | null>;
}

const hmac = (secret: string, data: string | Buffer) =>
  createHmac('sha256', secret).update(data).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The string Razorpay signs when it sends the payer back from a Payment Link. */
const linkPayload = (i: {
  linkId: string;
  referenceId: string;
  status: string;
  paymentId: string;
}) => `${i.linkId}|${i.referenceId}|${i.status}|${i.paymentId}`;

/** Razorpay-shaped webhook payloads (the fake provider uses the same shape). */
function parseRazorpayWebhook(body: unknown, eventIdHeader: string | undefined): WebhookInfo {
  const b = body as {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      payment_link?: { entity?: Record<string, unknown> };
    };
  };
  const eventId = eventIdHeader ?? '';
  const p = b?.payload?.payment?.entity;
  // A paid Payment Link: our payment is keyed by the link id, not by the order Razorpay made for it.
  if (b?.event === 'payment_link.paid') {
    const link = b?.payload?.payment_link?.entity;
    return {
      eventId,
      type: 'captured',
      orderId: typeof link?.id === 'string' ? link.id : undefined,
      paymentId: typeof p?.id === 'string' ? p.id : undefined,
      amountPaise: typeof p?.amount === 'number' ? p.amount : undefined,
    };
  }
  const base = {
    eventId,
    orderId: typeof p?.order_id === 'string' ? p.order_id : undefined,
    paymentId: typeof p?.id === 'string' ? p.id : undefined,
    amountPaise: typeof p?.amount === 'number' ? p.amount : undefined,
  };
  if (b?.event === 'payment.captured') return { ...base, type: 'captured' };
  if (b?.event === 'payment.failed') {
    return {
      ...base,
      type: 'failed',
      reason: typeof p?.error_description === 'string' ? p.error_description : undefined,
    };
  }
  return { ...base, type: 'ignored' };
}

/** Simulated gateway for development, tests and staging before real keys exist. */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly publicKeyId = null;
  // Not a real secret: the fake gateway only exists where fake payments are acceptable.
  static readonly SECRET = 'fake-gateway-secret';

  async createOrder(): Promise<GatewayOrder> {
    return { orderId: `fake_order_${randomUUID().replace(/-/g, '').slice(0, 14)}` };
  }

  /** What "the gateway" would sign after a successful checkout. */
  static sign(orderId: string, paymentId: string): string {
    return hmac(FakePaymentProvider.SECRET, `${orderId}|${paymentId}`);
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(FakePaymentProvider.sign(orderId, paymentId), signature);
  }

  private readonly links = new Map<string, string>();

  async createPaymentLink(): Promise<GatewayLink> {
    const linkId = `plink_fake${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const shortUrl = `https://rzp.io/fake/${linkId}`;
    this.links.set(linkId, shortUrl);
    return { linkId, shortUrl };
  }

  async getPaymentLink(linkId: string) {
    const shortUrl = this.links.get(linkId);
    return shortUrl ? { shortUrl, status: 'created' } : null;
  }

  /** What "the gateway" would sign when sending the payer back from a link. */
  static signLink(i: { linkId: string; referenceId: string; status: string; paymentId: string }) {
    return hmac(FakePaymentProvider.SECRET, linkPayload(i));
  }

  verifyLinkSignature(i: {
    linkId: string;
    referenceId: string;
    status: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return safeEqualHex(FakePaymentProvider.signLink(i), i.signature);
  }

  static signWebhook(rawBody: Buffer | string): string {
    return hmac(FakePaymentProvider.SECRET, rawBody);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return !!signature && safeEqualHex(FakePaymentProvider.signWebhook(rawBody), signature);
  }

  parseWebhook = parseRazorpayWebhook;

  private readonly refunds = new Map<string, string>();

  async refund(paymentId?: string): Promise<{ refundId: string }> {
    const refundId = `fake_refund_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    if (paymentId) this.refunds.set(paymentId, refundId);
    return { refundId };
  }

  async findRefund(paymentId: string): Promise<{ refundId: string } | null> {
    const refundId = this.refunds.get(paymentId);
    return refundId ? { refundId } : null;
  }

  async listPayments(): Promise<GatewayPayment[] | null> {
    return null;
  }
}

/** Real Razorpay via its REST API (no SDK needed). Verified against Razorpay's documented scheme. */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  get publicKeyId(): string {
    return this.keyId;
  }

  async createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
  }): Promise<GatewayOrder> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
      }),
    });
    if (!res.ok) {
      throw new Error(`Razorpay order creation failed with status ${res.status}`);
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error('Razorpay returned no order id');
    return { orderId: data.id };
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(hmac(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  async createPaymentLink(input: CreateLinkInput): Promise<GatewayLink> {
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        accept_partial: false,
        reference_id: input.referenceId.slice(0, 40),
        description: input.description.slice(0, 2048),
        customer: { name: input.customer.name, email: input.customer.email },
        // We send the payer there ourselves; no Razorpay SMS or email.
        notify: { sms: false, email: false },
        reminder_enable: false,
        callback_url: input.callbackUrl,
        callback_method: 'get',
        // A day is plenty to finish paying; a new link is made after that.
        expire_by: Math.floor(Date.now() / 1000) + 24 * 3600,
      }),
    });
    if (!res.ok) throw new Error(`Razorpay payment link creation failed with status ${res.status}`);
    const data = (await res.json()) as { id?: string; short_url?: string };
    if (!data.id || !data.short_url) throw new Error('Razorpay returned no payment link');
    return { linkId: data.id, shortUrl: data.short_url };
  }

  async getPaymentLink(linkId: string): Promise<{ shortUrl: string; status: string } | null> {
    const res = await fetch(
      `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(linkId)}`,
      {
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Razorpay payment link lookup failed with status ${res.status}`);
    const data = (await res.json()) as { short_url?: string; status?: string };
    return data.short_url && data.status ? { shortUrl: data.short_url, status: data.status } : null;
  }

  verifyLinkSignature(i: {
    linkId: string;
    referenceId: string;
    status: string;
    paymentId: string;
    signature: string;
  }): boolean {
    return safeEqualHex(hmac(this.keySecret, linkPayload(i)), i.signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return !!signature && safeEqualHex(hmac(this.webhookSecret, rawBody), signature);
  }

  parseWebhook = parseRazorpayWebhook;

  private get authHeader() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  async refund(paymentId: string, amountPaise: number): Promise<{ refundId: string }> {
    let res: Response;
    try {
      res = await fetch(
        `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json', Authorization: this.authHeader },
          body: JSON.stringify({ amount: amountPaise }),
        },
      );
    } catch (err) {
      // Network failure or timeout: the refund may still have been created.
      throw new GatewayRefundError(
        `Razorpay refund request failed: ${(err as Error).message}`,
        false,
      );
    }
    if (!res.ok) {
      throw new GatewayRefundError(
        `Razorpay refund failed with status ${res.status}`,
        res.status >= 400 && res.status < 500,
      );
    }
    let data: { id?: string };
    try {
      data = (await res.json()) as { id?: string };
    } catch (err) {
      throw new GatewayRefundError(
        `Razorpay refund response failed: ${(err as Error).message}`,
        false,
      );
    }
    if (!data.id) throw new GatewayRefundError('Razorpay returned no refund id', false);
    return { refundId: data.id };
  }

  async findRefund(paymentId: string): Promise<{ refundId: string } | null> {
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Razorpay refund lookup failed with status ${res.status}`);
    const data = (await res.json()) as { items?: { id?: string; status?: string }[] };
    const live = (data.items ?? []).find((r) => r.id && r.status !== 'failed');
    return live?.id ? { refundId: live.id } : null;
  }

  async listPayments(from: Date, to: Date): Promise<GatewayPayment[]> {
    const out: GatewayPayment[] = [];
    const count = 100;
    for (let skip = 0; ; skip += count) {
      const url =
        'https://api.razorpay.com/v1/payments' +
        `?from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}` +
        `&count=${count}&skip=${skip}`;
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Razorpay payment list failed with status ${res.status}`);
      const data = (await res.json()) as {
        items?: {
          id: string;
          order_id?: string | null;
          amount: number;
          status: string;
          amount_refunded?: number;
        }[];
      };
      const items = data.items ?? [];
      for (const p of items) {
        out.push({
          paymentId: p.id,
          orderId: p.order_id ?? null,
          amountPaise: p.amount,
          status: p.status,
          amountRefundedPaise: p.amount_refunded ?? 0,
        });
      }
      if (items.length < count) break;
    }
    return out;
  }
}

export function createPaymentProvider(env: Env): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    return new RazorpayProvider(
      env.RAZORPAY_KEY_ID!,
      env.RAZORPAY_KEY_SECRET!,
      env.RAZORPAY_WEBHOOK_SECRET!,
    );
  }
  return new FakePaymentProvider();
}
