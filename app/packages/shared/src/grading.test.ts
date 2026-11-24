import { describe, expect, it } from 'vitest';
import { gradeChoice, summarize, type GradableQuestion } from './grading';

const single: GradableQuestion = {
  type: 'SINGLE',
  correctOptions: [2],
  marks: 4,
  partialCredit: false,
};
const multi = (partialCredit: boolean): GradableQuestion => ({
  type: 'MULTI',
  correctOptions: [0, 1, 3],
  marks: 6,
  partialCredit,
});

describe('gradeChoice: single answer', () => {
  it('awards full marks for the right option', () => {
    expect(gradeChoice(single, [2])).toEqual({ marks: 4, outcome: 'CORRECT' });
  });
  it('gives zero for a wrong option, there is no negative marking', () => {
    expect(gradeChoice(single, [1])).toEqual({ marks: 0, outcome: 'WRONG' });
  });
  it('gives zero when unanswered', () => {
    expect(gradeChoice(single, [])).toEqual({ marks: 0, outcome: 'UNANSWERED' });
  });
  it('treats a wrong pick plus the right one as wrong', () => {
    expect(gradeChoice(single, [1, 2]).outcome).toBe('WRONG');
  });
});

describe('gradeChoice: multiple answer', () => {
  it('awards full marks only for the exact set, in any order', () => {
    expect(gradeChoice(multi(false), [3, 0, 1]).marks).toBe(6);
  });
  it('all-or-nothing: a missing option loses the marks and costs the penalty', () => {
    expect(gradeChoice(multi(false), [0, 1])).toEqual({ marks: 0, outcome: 'WRONG' });
  });
  it('partial credit: picking only correct options earns a share', () => {
    expect(gradeChoice(multi(true), [0, 1])).toEqual({ marks: 4, outcome: 'PARTIAL' });
    expect(gradeChoice(multi(true), [3])).toEqual({ marks: 2, outcome: 'PARTIAL' });
  });
  it('partial credit never rewards a wrong pick', () => {
    expect(gradeChoice(multi(true), [0, 1, 2])).toEqual({ marks: 0, outcome: 'WRONG' });
  });
  it('ignores duplicate selections', () => {
    expect(gradeChoice(multi(false), [0, 0, 1, 3, 3]).marks).toBe(6);
  });
  it('rounds partial marks to two decimals', () => {
    const q: GradableQuestion = { ...multi(true), marks: 1, correctOptions: [0, 1, 2] };
    expect(gradeChoice(q, [0]).marks).toBe(0.33);
  });
});

describe('summarize', () => {
  it('computes percent and pass', () => {
    expect(summarize({ awarded: [4, 4, -1], maxScore: 12, passPercent: 50 })).toEqual({
      score: 7,
      maxScore: 12,
      percent: 58.33,
      passed: true,
    });
  });
  it('passes at exactly the pass mark and fails just under it', () => {
    expect(summarize({ awarded: [5], maxScore: 10, passPercent: 50 }).passed).toBe(true);
    expect(summarize({ awarded: [4.9], maxScore: 10, passPercent: 50 }).passed).toBe(false);
  });
  it('never reports a negative score', () => {
    const s = summarize({ awarded: [-1, -1], maxScore: 8, passPercent: 40 });
    expect(s.score).toBe(0);
    expect(s.percent).toBe(0);
    expect(s.passed).toBe(false);
  });
  it('handles an exam with no marks', () => {
    expect(summarize({ awarded: [], maxScore: 0, passPercent: 40 }).percent).toBe(0);
  });
});
