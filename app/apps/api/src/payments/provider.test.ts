import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayProvider } from './provider';

const provider = new RazorpayProvider('test-key', 'test-secret', 'test-webhook-secret');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Razorpay request deadlines', () => {
  it('sets a fresh ten-second deadline on each gateway request, including pagination', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const payments = Array.from({ length: 100 }, (_, index) => ({
      id: `payment_${index}`,
      amount: 100,
      status: 'captured',
    }));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id: 'order_1' }))
      .mockResolvedValueOnce(Response.json({ id: 'refund_1' }))
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: payments }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);

    await provider.createOrder({ amountPaise: 100, currency: 'INR', receipt: 'receipt_1' });
    await provider.refund('payment_1', 100);
    await provider.findRefund('payment_1');
    expect(await provider.listPayments(new Date(0), new Date(1000))).toHaveLength(100);

    expect(timeout.mock.calls).toEqual(Array.from({ length: 5 }, () => [10_000]));
    expect(fetch.mock.calls.map(([, options]) => options?.signal)).toEqual(
      timeout.mock.results.map(({ value }) => value),
    );
  });

  it.each(['request', 'response body'])(
    'treats a refund %s timeout as ambiguous',
    async (phase) => {
      const timedOut = new DOMException('Request timed out', 'TimeoutError');
      const fetch = vi.fn<typeof globalThis.fetch>();
      if (phase === 'request') {
        fetch.mockRejectedValue(timedOut);
      } else {
        const response = Response.json({ id: 'refund_1' });
        vi.spyOn(response, 'json').mockRejectedValue(timedOut);
        fetch.mockResolvedValue(response);
      }
      vi.stubGlobal('fetch', fetch);

      await expect(provider.refund('payment_1', 100)).rejects.toMatchObject({ definite: false });
    },
  );
});
