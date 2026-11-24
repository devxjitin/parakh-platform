import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  assertBalanced,
  joinFeeLines,
  maskAccount,
  payoutDetailsSchema,
  payoutLines,
  platformFeeLines,
  reverseLines,
} from './ledger';

describe('ledger lines', () => {
  it('a join fee is split 50/50 and adds up to zero, to the paisa', () => {
    const lines = joinFeeLines(14_900, 'e1', 'x1');
    expect(lines.map((l) => [l.account, l.amountPaise])).toEqual([
      ['EXTERNAL', -14_900],
      ['EXAMINER:e1', 7_450],
      ['PLATFORM', 7_450],
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });

  it('keeps odd amounts exact: the platform takes the spare paisa', () => {
    for (const gross of [1, 99, 14_901, 20_001, 999_999]) {
      const lines = joinFeeLines(gross, 'e1', 'x1');
      expect(lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(0);
      const examiner = lines.find((l) => l.account === 'EXAMINER:e1')!.amountPaise;
      const platform = lines.find((l) => l.account === ACCOUNTS.PLATFORM)!.amountPaise;
      expect(platform - examiner).toBeGreaterThanOrEqual(0);
      expect(platform - examiner).toBeLessThanOrEqual(1);
    }
  });

  it('platform-only fees, payouts and refunds balance too', () => {
    expect(() => assertBalanced(platformFeeLines(19_900))).not.toThrow();
    expect(() => assertBalanced(payoutLines(52_150, 'e1'))).not.toThrow();
    const refund = reverseLines(joinFeeLines(14_900, 'e1', 'x1'));
    expect(refund.map((l) => l.amountPaise)).toEqual([14_900, -7_450, -7_450]);
    expect(() => assertBalanced(refund)).not.toThrow();
  });

  it('rejects anything that does not add up', () => {
    expect(() => assertBalanced([{ amountPaise: 100 }, { amountPaise: -99 }])).toThrow(
      /out of balance/,
    );
    expect(() => assertBalanced([{ amountPaise: 0 }])).toThrow();
    expect(() => assertBalanced([{ amountPaise: 1.5 }, { amountPaise: -1.5 }])).toThrow(
      /whole paise/,
    );
  });
});

describe('payout details', () => {
  it('accepts UPI ids and bank details, normalising the IFSC', () => {
    expect(payoutDetailsSchema.safeParse({ method: 'UPI', upiId: 'asha.rao@okhdfc' }).success).toBe(
      true,
    );
    const bank = payoutDetailsSchema.parse({
      method: 'BANK',
      accountName: 'Asha Rao',
      accountNumber: '123456789012',
      ifsc: ' hdfc0001234 ',
    });
    expect(bank).toMatchObject({ ifsc: 'HDFC0001234' });
  });

  it('rejects malformed ones', () => {
    expect(payoutDetailsSchema.safeParse({ method: 'UPI', upiId: 'nobank' }).success).toBe(false);
    expect(
      payoutDetailsSchema.safeParse({
        method: 'BANK',
        accountName: 'A',
        accountNumber: '12',
        ifsc: 'X',
      }).success,
    ).toBe(false);
    expect(payoutDetailsSchema.safeParse({ method: 'CASH' }).success).toBe(false);
  });

  it('masks account numbers', () => {
    expect(maskAccount('9012')).toBe('****9012');
    expect(maskAccount(null)).toBeNull();
  });
});
