import { describe, expect, it } from 'vitest';
import {
  AI_PAPER_SCHEMA,
  AI_PROMPT_MAX_QUESTIONS,
  aiBriefSchema,
  allocateCounts,
  buildAiPrompt,
  buildFixPrompt,
  buildMissingPrompt,
  parseAiPaper,
  planParts,
  type AiBrief,
  type AiBriefInput,
} from './ai-paper';
import { questionInputSchema } from './exam';

const base: AiBriefInput = {
  title: 'Cloud Computing Midterm',
  subject: 'Cloud Computing',
  topics: [
    { name: 'Networking', notes: 'OSI layers and IP addressing', count: 6 },
    { name: 'Security', notes: 'TLS and IAM', count: 4 },
  ],
  total: 10,
  types: { single: 6, multi: 2, written: 2 },
  difficulty: { easy: 3, medium: 5, hard: 2 },
  optionsPerQuestion: 5,
  audience: 'Final-year B.Tech, beginner',
  language: 'Hinglish',
  includeExplanations: true,
  includeRubric: true,
  sourceMaterial: 'ZZ-SOURCE: the shared responsibility model splits duties.',
  extraInstructions: 'ZZ-EXTRA: make them scenario based',
  avoid: 'ZZ-AVOID: pricing questions',
  marks: { single: 2, multi: 3, written: 5 },
  partialCredit: true,
};
const brief = (over: Partial<AiBriefInput> = {}): AiBrief =>
  aiBriefSchema.parse({ ...base, ...over });

describe('aiBriefSchema', () => {
  it('accepts a full brief and fills defaults', () => {
    const b = aiBriefSchema.parse({
      title: 'T',
      subject: 'S',
      topics: [{ name: 'A' }],
      total: 5,
      types: { single: 5, multi: 0, written: 0 },
      difficulty: { easy: 1, medium: 3, hard: 1 },
      audience: 'Beginners',
      language: 'English',
    });
    expect(b.optionsPerQuestion).toBe(4);
    expect(b.marks).toEqual({ single: 4, multi: 4, written: 4 });
    expect(b.includeExplanations).toBe(true);
  });

  it('refuses parts that do not add up to the total', () => {
    const bad = (over: Partial<AiBriefInput>) => aiBriefSchema.safeParse({ ...base, ...over });
    expect(bad({ types: { single: 5, multi: 2, written: 2 } }).success).toBe(false);
    expect(bad({ difficulty: { easy: 3, medium: 5, hard: 3 } }).success).toBe(false);
    expect(
      bad({
        topics: [
          { name: 'A', count: 6 },
          { name: 'B', count: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(bad({ topics: [{ name: 'A', count: 11 }, { name: 'B' }] }).success).toBe(false);
    expect(bad({ total: 301, types: { single: 301, multi: 0, written: 0 } }).success).toBe(false);
    expect(bad({ topics: [] }).success).toBe(false);
  });

  it('has no limit on the number of topics', () => {
    const topics = Array.from({ length: 40 }, (_, i) => ({ name: `Topic ${i + 1}` }));
    expect(aiBriefSchema.safeParse({ ...base, topics }).success).toBe(true);
  });

  it('allows topics without a number when something is left to share', () => {
    expect(
      aiBriefSchema.safeParse({ ...base, topics: [{ name: 'A', count: 4 }, { name: 'B' }] })
        .success,
    ).toBe(true);
  });
});

describe('allocateCounts', () => {
  it('shares the rest evenly and always adds up', () => {
    expect(allocateCounts(10, [null, null, null])).toEqual([4, 3, 3]);
    expect(allocateCounts(10, [5, null, null])).toEqual([5, 3, 2]);
    expect(allocateCounts(7, [null])).toEqual([7]);
    for (let total = 1; total <= 60; total++) {
      for (let rows = 1; rows <= 9; rows++) {
        const got = allocateCounts(total, Array(rows).fill(null));
        expect(got.reduce((s, n) => s + n, 0)).toBe(total);
        expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps fixed rows and rejects numbers that cannot add up', () => {
    expect(allocateCounts(10, [6, 4])).toEqual([6, 4]);
    expect(() => allocateCounts(10, [6, 5])).toThrow();
    expect(() => allocateCounts(10, [3, 3])).toThrow();
    expect(() => allocateCounts(10, [11, null])).toThrow();
  });
});

describe('planParts', () => {
  it('keeps a small paper in one part', () => {
    const parts = planParts(brief());
    expect(parts).toHaveLength(1);
    expect(parts[0].topics.map((t) => t.count)).toEqual([6, 4]);
    expect(parts[0].types).toEqual({ single: 6, multi: 2, written: 2 });
  });

  it('splits a big paper into parts of at most 25 whose counts add up to the whole', () => {
    const big = brief({
      total: 100,
      topics: [
        { name: 'A', count: 40 },
        { name: 'B', count: 35 },
        { name: 'C', count: 25 },
      ],
      types: { single: 70, multi: 20, written: 10 },
      difficulty: { easy: 30, medium: 50, hard: 20 },
    });
    const parts = planParts(big);
    expect(parts).toHaveLength(Math.ceil(100 / AI_PROMPT_MAX_QUESTIONS));
    const sum = (f: (p: (typeof parts)[number]) => number) => parts.reduce((s, p) => s + f(p), 0);
    for (const p of parts) {
      expect(p.size).toBeLessThanOrEqual(25);
      expect(p.topics.reduce((s, t) => s + t.count, 0)).toBe(p.size);
      expect(p.types.single + p.types.multi + p.types.written).toBe(p.size);
      expect(p.difficulty.easy + p.difficulty.medium + p.difficulty.hard).toBe(p.size);
    }
    expect(sum((p) => p.types.single)).toBe(70);
    expect(sum((p) => p.types.multi)).toBe(20);
    expect(sum((p) => p.difficulty.hard)).toBe(20);
    expect(sum((p) => p.topics[1].count)).toBe(35);
  });

  it('handles an uneven last part', () => {
    const parts = planParts(
      brief({
        total: 30,
        topics: [{ name: 'A' }],
        types: { single: 30, multi: 0, written: 0 },
        difficulty: { easy: 10, medium: 10, hard: 10 },
      }),
    );
    expect(parts.map((p) => p.size)).toEqual([25, 5]);
  });
});

describe('buildAiPrompt', () => {
  const b = brief();
  const prompt = buildAiPrompt(b);

  it('mentions every value of the brief', () => {
    for (const text of [
      'You are an expert exam-paper setter.',
      'Cloud Computing Midterm',
      'Subject or course: Cloud Computing',
      'Final-year B.Tech, beginner',
      'Hinglish',
      'exactly 10',
      'Networking: 6 questions',
      'OSI layers and IP addressing',
      'Security: 4 questions',
      'TLS and IAM',
      'SINGLE (single-answer multiple choice, exactly one correct option): 6',
      'MULTI (multiple-answer multiple choice, two or more correct options): 2',
      'SUBJECTIVE (written answer, no options): 2',
      'EASY: 3',
      'MEDIUM: 5',
      'HARD: 2',
      'exactly 5 options per question',
      '"rubric"',
      '"explanation"',
      'ZZ-SOURCE: the shared responsibility model splits duties.',
      'ZZ-EXTRA: make them scenario based',
      'ZZ-AVOID: pricing questions',
    ]) {
      expect(prompt, text).toContain(text);
    }
  });

  it('states the rules, the output format, the schema and the count rule', () => {
    for (const text of [
      'all of the above',
      'never repeat an option',
      'two or more correct options, never all of them',
      'Spread the correct answers evenly',
      'No two questions may test the same fact',
      'Question text up to 5000 characters',
      'no images, no tables, no LaTeX',
      'Reply with one JSON object and nothing else',
      'single ```json code block',
      'starting with { and ending with }',
      AI_PAPER_SCHEMA,
      '"type": "SINGLE"',
      '"type": "MULTI"',
      '"type": "SUBJECTIVE"',
      'the "questions" array must contain exactly 10 items',
      'SELF-CHECK',
    ]) {
      expect(prompt.toLowerCase(), text).toContain(text.toLowerCase());
    }
  });

  it('never asks the AI for marks', () => {
    expect(prompt).toContain('do not include marks');
    expect(prompt).not.toMatch(/negative marks|partial credit/i);
  });

  it('leaves out the sentence of every optional field that is off', () => {
    const none = buildAiPrompt(
      brief({
        sourceMaterial: undefined,
        extraInstructions: undefined,
        avoid: undefined,
        includeExplanations: false,
        includeRubric: false,
      }),
    );
    expect(none).not.toContain('SOURCE MATERIAL');
    expect(none).not.toContain('EXTRA INSTRUCTIONS');
    expect(none).not.toContain('TOPICS OR IDEAS TO AVOID');
    expect(none).not.toContain('EXPLANATIONS');
    expect(none).toContain('Do not add a rubric');
    const noWritten = buildAiPrompt(brief({ types: { single: 8, multi: 2, written: 0 } }));
    expect(noWritten).not.toContain('RULES FOR WRITTEN QUESTIONS');
  });

  it('is the same every time and names the part of a big paper', () => {
    expect(buildAiPrompt(b)).toBe(prompt);
    const big = brief({
      total: 40,
      topics: [{ name: 'A' }, { name: 'B' }],
      types: { single: 40, multi: 0, written: 0 },
      difficulty: { easy: 10, medium: 20, hard: 10 },
    });
    expect(buildAiPrompt(big, 0)).toContain('part 1 of 2 of a 40-question paper');
    expect(buildAiPrompt(big, 1)).toContain('part 2 of 2');
    expect(buildAiPrompt(big, 1)).toContain('exactly 15');
  });
});

// ---------------------------------------------------------------- the parser

const q = (over: Record<string, unknown> = {}) => ({
  type: 'SINGLE',
  topic: 'Networking',
  difficulty: 'EASY',
  body: 'Which layer routes packets?',
  options: ['Data link', 'Network', 'Transport', 'Session'],
  correct: ['B'],
  explanation: 'Layer 3.',
  ...over,
});
const wrap = (questions: unknown[], schema: string | undefined = AI_PAPER_SCHEMA) =>
  JSON.stringify({ ...(schema ? { schema } : {}), questions });
const parse = (text: string) => parseAiPaper(text, { brief: brief() });

describe('parseAiPaper: forgiving about format', () => {
  const good = wrap([q()]);

  it('reads plain JSON and converts letters to indexes with the brief marks', () => {
    const r = parse(good);
    expect(r.fatal).toBeNull();
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].input).toMatchObject({
      type: 'SINGLE',
      correctOptions: [1],
      marks: 2,
      explanation: 'Layer 3.',
    });
  });

  it('reads JSON inside code fences and with text around it', () => {
    expect(parse('```json\n' + good + '\n```').valid).toHaveLength(1);
    expect(
      parse('Sure! Here is your paper:\n\n' + good + '\n\nHope this helps.').valid,
    ).toHaveLength(1);
  });

  it('copes with a BOM, Windows line endings and a trailing comma', () => {
    const pretty = JSON.stringify(JSON.parse(good), null, 2).replace(/\n/g, '\r\n');
    expect(parse('﻿' + pretty).valid).toHaveLength(1);
    expect(parse(good.replace(']}', ',]}')).valid).toHaveLength(1);
    expect(parse(good.replace('}]}', ',}]}')).valid).toHaveLength(1);
  });

  it('copes with curly quotes used as JSON quotes', () => {
    expect(parse(good.replace(/"/g, '“')).valid).toHaveLength(1);
  });

  it('keeps curly quotes that are part of the text', () => {
    const r = parse(wrap([q({ body: 'What does “IaaS” stand for?' })]));
    expect(r.valid[0].input.body).toBe('What does “IaaS” stand for?');
  });

  it('accepts lower-case letters, a plain string for correct, and a missing schema name', () => {
    expect(parse(wrap([q({ correct: ['b'] })])).valid[0].input).toMatchObject({
      correctOptions: [1],
    });
    expect(parse(wrap([q({ correct: 'B' })])).valid).toHaveLength(1);
    expect(parse(wrap([q()], undefined)).valid).toHaveLength(1);
  });
});

describe('parseAiPaper: refuses what it cannot read', () => {
  it('says so when there is no JSON', () => {
    expect(parse('I could not do that.').fatal).toMatch(/No JSON/);
    expect(parse('').fatal).toMatch(/No JSON/);
  });

  it('spots an answer that was cut off', () => {
    const cut = wrap([q(), q({ body: 'Second?' })]).slice(0, 150);
    expect(parse(cut).fatal).toMatch(/stopped early/);
    expect(
      parse('{"schema":"parakh.paper.v1","questions":[{"type":"SINGLE","body":"abc').fatal,
    ).toMatch(/stopped early/);
  });

  it('gives the place of a real syntax error', () => {
    const r = parse('{"questions": [ {"type": "SINGLE" "body": "x"} ]}');
    expect(r.fatal).toMatch(/line \d+, column \d+/);
  });

  it('rejects a wrong format name, a missing list and too many questions', () => {
    expect(parse(wrap([q()], 'other.v2')).fatal).toMatch(/format name/);
    expect(parse('{"schema":"parakh.paper.v1"}').fatal).toMatch(/no "questions" list/);
    expect(parse('[1,2,3]').fatal).toBeTruthy();
    const many = Array.from({ length: 301 }, (_, i) => q({ body: `Question ${i}` }));
    expect(parse(wrap(many)).fatal).toMatch(/at most 300/);
  });
});

describe('parseAiPaper: checks every question', () => {
  it('flags a correct letter that does not exist', () => {
    const r = parse(wrap([q({ correct: ['F'] }), q({ correct: ['E'] })]));
    expect(r.valid).toHaveLength(0);
    expect(r.problems[0]).toEqual({
      number: 1,
      message: 'The correct answer F does not exist; there are only 4 options.',
    });
    expect(r.problems[1].message).toMatch(/E does not exist/);
  });

  it('flags the wrong number of correct options for the type', () => {
    expect(parse(wrap([q({ type: 'MULTI', correct: ['A'] })])).problems[0].message).toMatch(
      /at least two/,
    );
    expect(parse(wrap([q({ correct: ['A', 'B'] })])).problems[0].message).toMatch(/exactly one/);
    expect(parse(wrap([q({ correct: [] })])).problems).toHaveLength(1);
  });

  it('flags repeated options, too many options, over-long text and bad types', () => {
    expect(parse(wrap([q({ options: ['Same', 'same', 'C', 'D'] })])).problems[0].message).toMatch(
      /same/,
    );
    expect(
      parse(wrap([q({ options: ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'], correct: ['A'] })]))
        .problems[0].message,
    ).toMatch(/6 options; the brief asked for 5/);
    expect(parse(wrap([q({ body: 'x'.repeat(5001) })])).problems).toHaveLength(1);
    expect(parse(wrap([q({ type: 'ESSAY' })])).problems[0].message).toMatch(/type must be/);
    expect(parse(wrap([q({ body: undefined })])).problems[0].message).toMatch(/question text/);
    expect(parse(wrap(['nope'])).problems[0].message).toMatch(/not a question/);
  });

  it('keeps the 29 good questions when 1 of 30 is bad', () => {
    const list = Array.from({ length: 30 }, (_, i) => q({ body: `Unique question number ${i}?` }));
    list[6] = q({ body: 'Broken one', correct: ['D', 'Z'] });
    const r = parse(wrap(list));
    expect(r.found).toBe(30);
    expect(r.valid).toHaveLength(29);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].number).toBe(7);
    expect(r.valid.every((v) => questionInputSchema.safeParse(v.input).success)).toBe(true);
  });

  it('turns a written question into a SUBJECTIVE input with the written marks and a rubric', () => {
    const r = parse(
      wrap([
        {
          type: 'subjective',
          topic: 'Security',
          difficulty: 'hard',
          body: 'Explain TLS.',
          rubric: 'Key exchange.',
        },
      ]),
    );
    expect(r.valid[0].input).toMatchObject({
      type: 'SUBJECTIVE',
      marks: 5,
      rubric: 'Key exchange.',
    });
    expect(r.valid[0].difficulty).toBe('HARD');
  });

  it('applies partial credit only to multiple-answer questions', () => {
    const r = parse(wrap([q({ type: 'MULTI', correct: ['A', 'B'] }), q({ body: 'Another?' })]));
    expect(r.valid[0].input).toMatchObject({ partialCredit: true, marks: 3 });
    expect(r.valid[1].input).toMatchObject({ partialCredit: false, marks: 2 });
  });

  it('ignores marks the AI sent and strips control characters', () => {
    const r = parse(wrap([q({ marks: 99, body: 'Clean\u0000 this\u0007?' })]));
    expect(r.valid[0].input).toMatchObject({ marks: 2, body: 'Clean this?' });
  });
});

describe('parseAiPaper: counts and repeats are warnings', () => {
  const part = planParts(brief())[0];

  it('reports asked against got for total, type, difficulty and topic', () => {
    const r = parseAiPaper(
      wrap([q(), q({ body: 'Two?' }), q({ body: 'Three?', topic: 'Security' })]),
      {
        brief: brief(),
        expected: part,
      },
    );
    expect(r.valid).toHaveLength(3);
    expect(r.warnings).toContain('Questions: asked 10, got 3.');
    expect(r.warnings).toContain('Single-answer: asked 6, got 3.');
    expect(r.warnings).toContain('Written: asked 2, got 0.');
    expect(r.warnings).toContain('Medium: asked 5, got 0.');
    expect(r.warnings).toContain('Topic Networking: asked 6, got 2.');
    expect(r.warnings).toContain('Topic Security: asked 4, got 1.');
  });

  it('flags repeated questions, and ones already in the draft', () => {
    const r = parseAiPaper(wrap([q(), q(), q({ body: 'Already here?' })]), {
      brief: brief(),
      existingBodies: ['already  here?!'],
    });
    expect(r.warnings).toContain('Question 2 repeats question 1.');
    expect(r.warnings).toContain('Question 3 is already in this exam.');
  });
});

describe('follow-up prompts', () => {
  it('fix prompt lists each problem by number', () => {
    const text = buildFixPrompt([
      { number: 3, message: 'The correct answer D does not exist; there are only 3 options.' },
      { number: 7, message: 'Two options are the same.' },
    ]);
    expect(text).toContain('Question 3: The correct answer D does not exist');
    expect(text).toContain('Question 7: Two options are the same.');
    expect(text).toContain(AI_PAPER_SCHEMA);
  });

  it('missing prompt says what is still needed and what not to repeat', () => {
    const part = planParts(brief())[0];
    const check = parseAiPaper(wrap([q(), q({ body: 'Two?', topic: 'Security' })]), {
      brief: brief(),
      expected: part,
    });
    const text = buildMissingPrompt(check, part);
    expect(text).toContain(
      'You returned 2 usable questions of 10. Write the 8 that are still missing.',
    );
    expect(text).toContain('- Single-answer: 4');
    expect(text).toContain('- Written: 2');
    expect(text).toContain('- Topic Networking: 5');
    expect(text).toContain('- Topic Security: 3');
    expect(text).toContain('Do not repeat these questions:');
    expect(text).toContain('- Which layer routes packets?');
  });
});

describe('round trip', () => {
  it('a hand-written AI answer to the generated brief passes every check', () => {
    const b = brief({
      total: 4,
      topics: [
        { name: 'Networking', count: 2 },
        { name: 'Security', count: 2 },
      ],
      types: { single: 2, multi: 1, written: 1 },
      difficulty: { easy: 1, medium: 2, hard: 1 },
      optionsPerQuestion: 4,
    });
    expect(buildAiPrompt(b)).toContain('exactly 4 items');
    const part = planParts(b)[0];
    const answer =
      'Here you go:\n```json\n' +
      JSON.stringify({
        schema: AI_PAPER_SCHEMA,
        questions: [
          q({ body: 'Layer that routes?', difficulty: 'EASY' }),
          q({ type: 'MULTI', body: 'Private ranges?', correct: ['A', 'B'], difficulty: 'MEDIUM' }),
          q({
            topic: 'Security',
            body: 'What does TLS protect?',
            difficulty: 'MEDIUM',
            correct: ['C'],
          }),
          {
            type: 'SUBJECTIVE',
            topic: 'Security',
            difficulty: 'HARD',
            body: 'Explain a handshake.',
            rubric: 'Keys.',
          },
        ],
      }) +
      '\n```';
    const r = parseAiPaper(answer, { brief: b, expected: part });
    expect(r.fatal).toBeNull();
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.valid).toHaveLength(4);
    for (const v of r.valid) expect(questionInputSchema.safeParse(v.input).success).toBe(true);
  });
});
