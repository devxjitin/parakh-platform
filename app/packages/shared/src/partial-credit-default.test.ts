import { describe, expect, it } from 'vitest';
import { aiBriefSchema } from './ai-paper';
import { questionInputSchema } from './exam';

describe('partial credit default', () => {
  it('is on for a new multiple-answer question unless said otherwise', () => {
    const q = questionInputSchema.parse({
      type: 'MULTI',
      body: 'Pick public clouds',
      options: ['AWS', 'Azure', 'Excel'],
      correctOptions: [0, 1],
      marks: 3,
    });
    expect(q).toMatchObject({ partialCredit: true });
  });

  it('is on in an AI brief that does not mention it', () => {
    const r = aiBriefSchema.safeParse({
      title: 'T',
      subject: 'S',
      topics: [{ name: 'A' }],
      total: 2,
      types: { single: 0, multi: 2, written: 0 },
      difficulty: { easy: 1, medium: 1, hard: 0 },
      optionsPerQuestion: 4,
      audience: 'Students',
      language: 'English',
      includeExplanations: false,
      includeRubric: false,
    });
    expect(r.success && r.data.partialCredit).toBe(true);
  });
});
