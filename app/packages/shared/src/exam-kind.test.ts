import { describe, expect, it } from 'vitest';
import { examKind, pricingMode, studentJoinFee } from './exam-kind';

const base = {
  alwaysOpen: false,
  nandivexHosted: false,
  studentFeePaise: null,
  sponsoredEmails: [],
};

describe('exam kind', () => {
  it('a trainer exam: the student pays the platform fee', () => {
    expect(examKind(base)).toBe('TRAINER_STUDENT_PAYS');
    expect(studentJoinFee(base, 4900)).toBe(4900);
  });

  it('a trainer exam ignores any stray student fee', () => {
    expect(studentJoinFee({ ...base, studentFeePaise: 100 }, 4900)).toBe(4900);
  });

  it('a sponsored exam is free for students, even on a NandiVex exam with a fee', () => {
    const sponsored = { ...base, sponsoredEmails: ['a@b.test'] };
    expect(examKind(sponsored)).toBe('TRAINER_SPONSORED');
    expect(studentJoinFee(sponsored, 4900)).toBe(0);
    expect(pricingMode({ ...sponsored, nandivexHosted: true, studentFeePaise: 500 })).toBe(
      'TRAINER_SPONSORED',
    );
  });

  it('a NandiVex exam uses its own fee: 0 is free, above 0 is paid', () => {
    const free = { ...base, nandivexHosted: true, studentFeePaise: 0 };
    const paid = { ...base, nandivexHosted: true, studentFeePaise: 2500 };
    expect(examKind(free)).toBe('NANDIVEX_FREE');
    expect(studentJoinFee(free, 4900)).toBe(0);
    expect(examKind(paid)).toBe('NANDIVEX_PAID');
    expect(studentJoinFee(paid, 4900)).toBe(2500);
  });

  it('a NandiVex exam with no fee set uses the platform fee', () => {
    const exam = { ...base, nandivexHosted: true };
    expect(pricingMode(exam)).toBe('TRAINER_STUDENT_PAYS');
    expect(studentJoinFee(exam, 4900)).toBe(4900);
  });

  it('always-open is its own kind, and its fee still follows the pricing mode', () => {
    const exam = { ...base, alwaysOpen: true, nandivexHosted: true, studentFeePaise: 0 };
    expect(examKind(exam)).toBe('ALWAYS_OPEN');
    expect(studentJoinFee(exam, 4900)).toBe(0);
  });
});
