import { describe, expect, it } from 'vitest';
import { PRICING } from './constants';
import { formatInr, splitGross } from './money';

describe('splitGross', () => {
  it('splits the Rs 49 join fee 50/50 with no paise lost', () => {
    const s = splitGross(PRICING.EXAM_JOIN_PAISE);
    expect(s.examinerPaise).toBe(24_50);
    expect(s.platformPaise).toBe(24_50);
    expect(s.examinerPaise + s.platformPaise).toBe(PRICING.EXAM_JOIN_PAISE);
  });

  it('gives the odd paisa to the platform', () => {
    const s = splitGross(101);
    expect(s).toEqual({ examinerPaise: 50, platformPaise: 51 });
  });

  it('rejects invalid input', () => {
    expect(() => splitGross(-1)).toThrow(RangeError);
    expect(() => splitGross(10.5)).toThrow(RangeError);
    expect(() => splitGross(100, 120)).toThrow(RangeError);
  });
});

describe('formatInr', () => {
  it('formats paise as rupees', () => {
    expect(formatInr(49_00)).toBe('₹49.00');
  });
});
