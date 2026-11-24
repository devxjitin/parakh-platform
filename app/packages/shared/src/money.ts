import { PRICING } from './constants';

export interface Split {
  examinerPaise: number;
  platformPaise: number;
}

/**
 * Splits a gross amount between examiner and platform.
 * Examiner gets floor(gross * percent / 100); platform keeps the remainder,
 * so the two parts always add up to the gross amount exactly.
 */
export function splitGross(
  grossPaise: number,
  examinerPercent: number = PRICING.EXAMINER_SHARE_PERCENT,
): Split {
  if (!Number.isInteger(grossPaise) || grossPaise < 0) {
    throw new RangeError('grossPaise must be a non-negative integer');
  }
  if (examinerPercent < 0 || examinerPercent > 100) {
    throw new RangeError('examinerPercent must be between 0 and 100');
  }
  const examinerPaise = Math.floor((grossPaise * examinerPercent) / 100);
  return { examinerPaise, platformPaise: grossPaise - examinerPaise };
}

export function formatInr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
