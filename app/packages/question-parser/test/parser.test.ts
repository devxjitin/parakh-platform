import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuestionsTxt } from '../src';

describe('parseQuestionsTxt', () => {
  it('returns [] for empty input', () => {
    expect(parseQuestionsTxt('')).toEqual([]);
    expect(parseQuestionsTxt('   \n ')).toEqual([]);
  });

  it('parses bullet options with inline (Correct) marker', () => {
    const q = parseQuestionsTxt(
      `Question 1:\nWhat is DNSSEC?\nOptions:\n- Zone transfer\n- DNSSEC (Correct)\n- Resource records`,
    );
    expect(q).toHaveLength(1);
    expect(q[0].body).toBe('What is DNSSEC?');
    expect(q[0].options).toEqual(['Zone transfer', 'DNSSEC', 'Resource records']);
    expect(q[0].correctOptions).toEqual([1]);
    expect(q[0].type).toBe('SINGLE');
  });

  it('parses lettered options with an Answer line', () => {
    const q = parseQuestionsTxt(`1. Capital of India?\nA) Mumbai\nB) Delhi\nC) Pune\nAnswer: B`);
    expect(q[0].correctOptions).toEqual([1]);
  });

  it('detects multi-select from "Answer: A, C"', () => {
    const q = parseQuestionsTxt(`Q1. Pick primes\nA. 2\nB. 4\nC. 5\nD. 6\nAnswer: A, C`);
    expect(q[0].type).toBe('MULTI');
    expect(q[0].correctOptions).toEqual([0, 2]);
  });

  it('applies default marks and keeps explanations', () => {
    const q = parseQuestionsTxt(`Q1. x?\nA. a\nB. b\nAnswer: A\nExplanation: because`, {
      defaultMarks: 2,
    });
    expect(q[0]).toMatchObject({ marks: 2, explanation: 'because' });
  });

  it('parses the 125-question CEH sample file', () => {
    const txt = readFileSync(join(__dirname, 'fixtures', 'ceh_v13_125_questions.txt'), 'utf8');
    const q = parseQuestionsTxt(txt);
    expect(q).toHaveLength(125);
    for (const item of q) {
      expect(item.options.length).toBeGreaterThanOrEqual(2);
      expect(item.correctOptions.length).toBeGreaterThanOrEqual(1);
    }
  });
});
