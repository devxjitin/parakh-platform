import { describe, expect, it } from 'vitest';
import {
  createExamSchema,
  paperPlanSchema,
  planMarksFor,
  planTotalMarks,
  updateExamSchema,
} from './exam';

const plan = {
  totalQuestions: 30,
  singleCount: 15,
  multiCount: 5,
  subjectiveCount: 10,
  singleMarks: 2,
  multiMarks: 3,
  subjectiveMarks: 5,
};

describe('planTotalMarks', () => {
  it('adds up each kind of question at its own marks', () => {
    expect(planTotalMarks(plan)).toBe(15 * 2 + 5 * 3 + 10 * 5);
    expect(planTotalMarks({ ...plan, singleMarks: 1.5, multiCount: 0, subjectiveCount: 0 })).toBe(
      22.5,
    );
  });

  it('gives the marks of one question by type', () => {
    expect(planMarksFor(plan, 'SINGLE')).toBe(2);
    expect(planMarksFor(plan, 'MULTI')).toBe(3);
    expect(planMarksFor(plan, 'SUBJECTIVE')).toBe(5);
  });
});

describe('paperPlanSchema', () => {
  it('accepts counts that add up to the total', () => {
    expect(paperPlanSchema.safeParse(plan).success).toBe(true);
    expect(
      paperPlanSchema.safeParse({
        ...plan,
        totalQuestions: 5,
        singleCount: 5,
        multiCount: 0,
        subjectiveCount: 0,
        multiMarks: 0,
        subjectiveMarks: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects counts that do not add up to the total', () => {
    const r = paperPlanSchema.safeParse({ ...plan, totalQuestions: 31 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/add up/);
    expect(paperPlanSchema.safeParse({ ...plan, multiCount: 4 }).success).toBe(false);
  });

  it('needs whole, non-negative counts and at least one question', () => {
    expect(
      paperPlanSchema.safeParse({
        ...plan,
        totalQuestions: 0,
        singleCount: 0,
        multiCount: 0,
        subjectiveCount: 0,
      }).success,
    ).toBe(false);
    expect(
      paperPlanSchema.safeParse({ ...plan, totalQuestions: 5, singleCount: 2.5, multiCount: 2.5 })
        .success,
    ).toBe(false);
    expect(
      paperPlanSchema.safeParse({ ...plan, totalQuestions: 5, singleCount: 7, multiCount: -2 })
        .success,
    ).toBe(false);
  });

  it('needs marks for a kind that has questions, but not for an empty kind', () => {
    expect(paperPlanSchema.safeParse({ ...plan, singleMarks: 0 }).success).toBe(false);
    expect(paperPlanSchema.safeParse({ ...plan, multiMarks: 0 }).success).toBe(false);
    expect(paperPlanSchema.safeParse({ ...plan, subjectiveMarks: 0 }).success).toBe(false);
    expect(
      paperPlanSchema.safeParse({ ...plan, totalQuestions: 25, multiCount: 0, multiMarks: 0 })
        .success,
    ).toBe(true);
  });

  it('is optional when creating an exam', () => {
    const base = {
      title: 'Cloud basics',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    expect(createExamSchema.safeParse(base).success).toBe(true);
    expect(createExamSchema.safeParse({ ...base, paperPlan: plan }).success).toBe(true);
    expect(
      createExamSchema.safeParse({ ...base, paperPlan: { ...plan, totalQuestions: 1 } }).success,
    ).toBe(false);
  });

  it('can be changed on an existing exam, and must still add up', () => {
    expect(updateExamSchema.safeParse({ paperPlan: plan }).success).toBe(true);
    expect(updateExamSchema.safeParse({ paperPlan: { ...plan, totalQuestions: 1 } }).success).toBe(
      false,
    );
  });
});
