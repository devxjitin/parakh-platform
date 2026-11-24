import { z } from 'zod';
import { LIMITS } from './constants';
import { questionInputSchema, type QuestionInput } from './exam';

/**
 * AI Paper Builder (Sprint 4.4). The trainer describes a paper (the brief), copies a ready-made
 * prompt into any outside AI, and pastes the JSON answer back. Everything here is pure: the web
 * builds the prompt and shows the check, and the API runs the very same parser before it saves
 * anything, so the two can never disagree. Parakh never calls an AI service.
 */

export const AI_PAPER_SCHEMA = 'parakh.paper.v1';
/** Largest number of questions asked of the AI in one prompt. Bigger papers are split into parts. */
export const AI_PROMPT_MAX_QUESTIONS = 25;
export const AI_SOURCE_MAX = 6000;

export type AiQuestionType = 'SINGLE' | 'MULTI' | 'SUBJECTIVE';
export type AiDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

// -------------------------------------------------------------------- the brief

const count = z.number().int().min(0).max(LIMITS.MAX_QUESTIONS_PER_EXAM);
const marks = z.number().min(0).max(100);

export const aiTopicSchema = z.object({
  name: z.string().trim().min(1, 'Name the topic').max(100),
  notes: z.string().trim().max(300).optional(),
  /** Leave empty to share the remaining questions evenly between the topics without a number. */
  count: count.nullish(),
});
export type AiTopic = z.infer<typeof aiTopicSchema>;

export const aiBriefSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter the paper title').max(150),
    subject: z.string().trim().min(1, 'Enter the subject or course').max(150),
    topics: z.array(aiTopicSchema).min(1, 'Add at least one topic'),
    total: z.number().int().min(1).max(LIMITS.MAX_QUESTIONS_PER_EXAM),
    types: z.object({ single: count, multi: count, written: count }),
    difficulty: z.object({ easy: count, medium: count, hard: count }),
    optionsPerQuestion: z.number().int().min(2).max(6).default(4),
    audience: z.string().trim().min(1, 'Describe the audience and level').max(200),
    language: z.string().trim().min(1, 'Choose the language').max(60),
    includeExplanations: z.boolean().default(true),
    includeRubric: z.boolean().default(true),
    sourceMaterial: z.string().trim().max(AI_SOURCE_MAX).optional(),
    extraInstructions: z.string().trim().max(1000).optional(),
    avoid: z.string().trim().max(500).optional(),
    // Applied by Parakh when the questions are saved. The AI is never asked for them.
    marks: z
      .object({ single: marks, multi: marks, written: marks })
      .default({ single: 4, multi: 4, written: 4 }),
    partialCredit: z.boolean().default(true),
  })
  .superRefine((b, ctx) => {
    const typeSum = b.types.single + b.types.multi + b.types.written;
    if (typeSum !== b.total) {
      ctx.addIssue({
        code: 'custom',
        path: ['types'],
        message: `Question types add up to ${typeSum} of ${b.total}`,
      });
    }
    const diffSum = b.difficulty.easy + b.difficulty.medium + b.difficulty.hard;
    if (diffSum !== b.total) {
      ctx.addIssue({
        code: 'custom',
        path: ['difficulty'],
        message: `Difficulty levels add up to ${diffSum} of ${b.total}`,
      });
    }
    const fixed = b.topics.reduce((s, t) => s + (t.count ?? 0), 0);
    const free = b.topics.filter((t) => t.count == null).length;
    if (fixed > b.total || (free === 0 && fixed !== b.total)) {
      ctx.addIssue({
        code: 'custom',
        path: ['topics'],
        message: `Topics add up to ${fixed} of ${b.total}`,
      });
    }
  });
export type AiBrief = z.infer<typeof aiBriefSchema>;
/** What the form holds while it is being filled in (before defaults are applied). */
export type AiBriefInput = z.input<typeof aiBriefSchema>;

export const aiImportSchema = z.object({
  /** What the AI replied, pasted as it came. */
  text: z.string().min(1).max(500_000),
  brief: aiBriefSchema,
  /** Which part of a big paper this answer is for (0-based). */
  partIndex: z.number().int().min(0).max(20).default(0),
  // false = check only and show what would be imported.
  commit: z.boolean().default(false),
});
export type AiImportInput = z.infer<typeof aiImportSchema>;

export interface AiImportResult {
  committed: boolean;
  /** Questions that can still be added to this exam (the limit is 300). */
  room: number;
  check: AiPaperCheck;
}

// ------------------------------------------------------------------ split counts

/**
 * Gives every row its count. Rows with a number keep it; what is left is shared as evenly as
 * possible between the rows without one (the first rows take the extra), so the total always
 * matches exactly. Throws when the numbers cannot add up.
 */
export function allocateCounts(total: number, rows: (number | null | undefined)[]): number[] {
  const fixed = rows.reduce<number>((s, r) => s + (r ?? 0), 0);
  const free = rows.filter((r) => r == null).length;
  if (fixed > total) throw new Error(`The numbers add up to ${fixed}, more than ${total}`);
  if (free === 0) {
    if (fixed !== total) throw new Error(`The numbers add up to ${fixed} of ${total}`);
    return rows.map((r) => r as number);
  }
  const rest = total - fixed;
  const base = Math.floor(rest / free);
  let extra = rest - base * free;
  return rows.map((r) => {
    if (r != null) return r;
    const n = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    return n;
  });
}

/** Takes `size` out of `remaining`, in proportion to each entry (largest remainder). */
function takeShare(remaining: number[], size: number): number[] {
  const total = remaining.reduce((s, n) => s + n, 0);
  if (total === 0) return remaining.map(() => 0);
  const exact = remaining.map((n) => (n * size) / total);
  const taken = exact.map((x) => Math.floor(x));
  let left = size - taken.reduce((s, n) => s + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    if (taken[i] < remaining[i]) {
      taken[i]++;
      left--;
    }
  }
  return taken;
}

export interface AiPromptPart {
  /** 0-based. */
  index: number;
  of: number;
  size: number;
  topics: { name: string; notes: string; count: number }[];
  types: { single: number; multi: number; written: number };
  difficulty: { easy: number; medium: number; hard: number };
}

/** Splits a brief into prompts of at most `maxPerPart` questions, each complete on its own. */
export function planParts(brief: AiBrief, maxPerPart = AI_PROMPT_MAX_QUESTIONS): AiPromptPart[] {
  const of = Math.ceil(brief.total / maxPerPart);
  const topicCounts = allocateCounts(
    brief.total,
    brief.topics.map((t) => t.count),
  );
  let topics = topicCounts;
  let types = [brief.types.single, brief.types.multi, brief.types.written];
  let diff = [brief.difficulty.easy, brief.difficulty.medium, brief.difficulty.hard];
  const parts: AiPromptPart[] = [];
  for (let index = 0; index < of; index++) {
    const size = Math.min(maxPerPart, brief.total - index * maxPerPart);
    const t = takeShare(topics, size);
    const y = takeShare(types, size);
    const d = takeShare(diff, size);
    topics = topics.map((n, i) => n - t[i]);
    types = types.map((n, i) => n - y[i]);
    diff = diff.map((n, i) => n - d[i]);
    parts.push({
      index,
      of,
      size,
      topics: brief.topics.map((x, i) => ({ name: x.name, notes: x.notes ?? '', count: t[i] })),
      types: { single: y[0], multi: y[1], written: y[2] },
      difficulty: { easy: d[0], medium: d[1], hard: d[2] },
    });
  }
  return parts;
}

// -------------------------------------------------------------------- the prompt

const EXAMPLE = `{
  "schema": "${AI_PAPER_SCHEMA}",
  "questions": [
    { "type": "SINGLE", "topic": "Networking", "difficulty": "EASY",
      "body": "Which layer of the OSI model handles routing?",
      "options": ["Data link", "Network", "Transport", "Session"],
      "correct": ["B"],
      "explanation": "Routing is done by the Network layer (layer 3)." },
    { "type": "MULTI", "topic": "Networking", "difficulty": "MEDIUM",
      "body": "Which of these are private IPv4 ranges?",
      "options": ["10.0.0.0/8", "172.16.0.0/12", "8.8.8.0/24", "192.168.0.0/16"],
      "correct": ["A", "B", "D"],
      "explanation": "RFC 1918 reserves 10/8, 172.16/12 and 192.168/16." },
    { "type": "SUBJECTIVE", "topic": "Security", "difficulty": "HARD",
      "body": "Explain how a TLS handshake protects a login form.",
      "rubric": "Award marks for certificate check, key exchange and encryption of traffic." }
  ]
}`;

/** The prompt for one part of the paper. Deterministic: the same brief always gives the same text. */
export function buildAiPrompt(brief: AiBrief, partIndex = 0): string {
  const parts = planParts(brief);
  const part = parts[Math.min(Math.max(partIndex, 0), parts.length - 1)];
  const k = brief.optionsPerQuestion;
  const L: string[] = [];
  const add = (...lines: string[]) => L.push(...lines);

  add('You are an expert exam-paper setter.', '');
  add('PAPER');
  add(`- Title: ${brief.title}`);
  add(`- Subject or course: ${brief.subject}`);
  add(`- Audience and level: ${brief.audience}`);
  add(`- Language of questions, options and explanations: ${brief.language}`);
  add(
    part.of > 1
      ? `- Questions in this reply: exactly ${part.size} (part ${part.index + 1} of ${part.of} of a ${brief.total}-question paper)`
      : `- Questions in this reply: exactly ${part.size}`,
    '',
  );

  add('TOPICS (write exactly this many questions on each topic)');
  for (const t of part.topics.filter((x) => x.count > 0)) {
    add(
      `- ${t.name}: ${t.count} question${t.count === 1 ? '' : 's'}${t.notes ? `. Focus: ${t.notes}` : ''}`,
    );
  }
  add('');

  add('QUESTION TYPES (use exactly these counts)');
  add(
    `- SINGLE (single-answer multiple choice, exactly one correct option): ${part.types.single}`,
    `- MULTI (multiple-answer multiple choice, two or more correct options): ${part.types.multi}`,
    `- SUBJECTIVE (written answer, no options): ${part.types.written}`,
    '',
  );

  add('DIFFICULTY (use exactly these counts, spread across the topics)');
  add(
    `- EASY: ${part.difficulty.easy}`,
    `- MEDIUM: ${part.difficulty.medium}`,
    `- HARD: ${part.difficulty.hard}`,
    '',
  );

  add('RULES FOR MULTIPLE-CHOICE QUESTIONS (SINGLE and MULTI)');
  add(
    `- Give exactly ${k} options per question.`,
    '- SINGLE has exactly one correct option. MULTI has two or more correct options, never all of them.',
    '- Do not use "all of the above" or "none of the above".',
    '- Keep the options a similar length. Make the wrong options plausible. Never repeat an option inside a question.',
    '- Spread the correct answers evenly over A, B, C, D and so on.',
    '- No two questions may test the same fact.',
    '',
  );

  if (part.types.written > 0) {
    add('RULES FOR WRITTEN QUESTIONS (SUBJECTIVE)');
    add('- No options. One clear question.');
    add(
      brief.includeRubric
        ? '- Add a short "rubric": a marking guide for the person who marks the answer.'
        : '- Do not add a rubric.',
      '',
    );
  }

  if (brief.includeExplanations) {
    add('EXPLANATIONS');
    add(
      '- For SINGLE and MULTI questions add "explanation": one or two lines on why the answer is correct.',
      '',
    );
  }

  add('LENGTH LIMITS');
  add(
    '- Question text up to 5000 characters, each option up to 1000, explanation up to 3000, rubric up to 3000.',
    '',
  );

  add('CONTENT RULES');
  add(
    '- Plain text only: no images, no tables, no LaTeX and no code that needs a diagram.',
    '- Be factually correct. No trick questions. Do not copy copyrighted text word for word.',
    '- Marks are decided by the teacher, so do not include marks.',
    '',
  );

  if (brief.sourceMaterial) {
    add('SOURCE MATERIAL (base the questions only on this text)');
    add('"""', brief.sourceMaterial, '"""', '');
  }
  if (brief.extraInstructions) add('EXTRA INSTRUCTIONS', brief.extraInstructions, '');
  if (brief.avoid) add('TOPICS OR IDEAS TO AVOID', brief.avoid, '');

  add('OUTPUT RULES');
  add(
    'Reply with one JSON object and nothing else: no greeting and no explanation. Put the whole JSON inside a single ```json code block: the first line of your reply is ```json, then the object (starting with { and ending with }), then a closing ``` line. Write nothing before or after the code block.',
    `Use "correct" with letters (A is the first option). Use "topic" exactly as written above and "difficulty" as EASY, MEDIUM or HARD.`,
    '',
    'SHAPE, with one example of each type:',
    EXAMPLE,
    '',
  );

  add(
    `COUNT RULE: the "questions" array must contain exactly ${part.size} items. Count them before you answer.`,
    '',
    'SELF-CHECK before replying: every "correct" letter exists in "options"; the counts per type, topic and difficulty match; the JSON is valid.',
  );
  return L.join('\n');
}

// ---------------------------------------------------------------- reading the answer

export interface AiProblem {
  /** 1-based position in the pasted answer. */
  number: number;
  message: string;
}

export interface AiParsedQuestion {
  number: number;
  topic: string | null;
  difficulty: AiDifficulty | null;
  input: QuestionInput;
}

export interface AiPaperCheck {
  /** Set when nothing can be read at all (not JSON, cut off, wrong format). */
  fatal: string | null;
  /** Questions that passed every check and can be imported. */
  valid: AiParsedQuestion[];
  /** Questions that cannot be imported, with the reason. */
  problems: AiProblem[];
  /** Differences from what was asked, and repeated questions. Not blocking. */
  warnings: string[];
  found: number;
  byType: Record<AiQuestionType, number>;
  byDifficulty: Record<AiDifficulty, number>;
  byTopic: Record<string, number>;
}

const SMART: [RegExp, string][] = [
  [/[“”„‟]/g, '"'],
  [/[‘’‚‛]/g, "'"],
];

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanText(s: string): string {
  return s.replace(CONTROL, '').trim();
}

function jsonOnly(raw: string): string | null {
  let t = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  t = t.replace(/```[a-zA-Z]*\s*/g, '');
  const a = t.indexOf('{');
  if (a < 0) return null;
  const b = t.lastIndexOf('}');
  return b > a ? t.slice(a, b + 1) : t.slice(a);
}

/** True when the text ends inside an open object, array or string (the AI stopped early). */
function endsEarly(json: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return inString || depth > 0;
}

function lineColumn(text: string, position: number): string {
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  return `line ${line}, column ${column}`;
}

function tryParse(json: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let lastError = '';
  const attempts = [
    json,
    json.replace(/,(\s*[}\]])/g, '$1'),
    SMART.reduce((s, [re, to]) => s.replace(re, to), json).replace(/,(\s*[}\]])/g, '$1'),
  ];
  for (const text of attempts) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const at = /position (\d+)/.exec(lastError);
      if (at) lastError = `The JSON is broken near ${lineColumn(text, Number(at[1]))}.`;
      else lastError = 'The text is not valid JSON.';
    }
  }
  return { ok: false, error: lastError };
}

const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const emptyCheck = (fatal: string): AiPaperCheck => ({
  fatal,
  valid: [],
  problems: [],
  warnings: [],
  found: 0,
  byType: { SINGLE: 0, MULTI: 0, SUBJECTIVE: 0 },
  byDifficulty: { EASY: 0, MEDIUM: 0, HARD: 0 },
  byTopic: {},
});

/**
 * Reads what an AI replied. It forgives what AI tools really send (code fences, a sentence around
 * the JSON, curly quotes, a trailing comma) but trusts nothing: every question is checked with the
 * same rules as a question typed in by hand. One bad question never rejects the others.
 *
 * `expected` (one part of the brief) turns wrong counts into warnings. `existingBodies` are the
 * questions already in the draft, so a repeat is flagged.
 */
export function parseAiPaper(
  raw: string,
  opts: {
    brief?: Pick<AiBrief, 'marks' | 'partialCredit' | 'optionsPerQuestion'>;
    expected?: AiPromptPart;
    existingBodies?: string[];
  } = {},
): AiPaperCheck {
  const json = jsonOnly(raw);
  if (!json)
    return emptyCheck('No JSON was found in the pasted text. Paste the AI answer in full.');

  const parsed = tryParse(json);
  if (!parsed.ok) {
    return emptyCheck(
      endsEarly(json)
        ? 'The AI stopped early, so the answer is cut off. Type "continue" in the AI chat and paste the full result, or use the missing-questions prompt.'
        : parsed.error,
    );
  }
  const root = parsed.value as { schema?: unknown; questions?: unknown };
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return emptyCheck('The answer must be one JSON object with a "questions" list.');
  }
  if (root.schema !== undefined && root.schema !== AI_PAPER_SCHEMA) {
    return emptyCheck(
      `The format name must be "${AI_PAPER_SCHEMA}", not "${String(root.schema)}".`,
    );
  }
  if (!Array.isArray(root.questions)) {
    return emptyCheck('The answer has no "questions" list.');
  }
  if (root.questions.length > LIMITS.MAX_QUESTIONS_PER_EXAM) {
    return emptyCheck(
      `The answer has ${root.questions.length} questions; one paper holds at most ${LIMITS.MAX_QUESTIONS_PER_EXAM}.`,
    );
  }

  const marks = opts.brief?.marks ?? { single: 4, multi: 4, written: 4 };
  const partial = opts.brief?.partialCredit ?? true;
  const maxOptions = opts.brief?.optionsPerQuestion ?? 6;

  const out = emptyCheck('');
  out.fatal = null;
  out.found = root.questions.length;
  const seen = new Map<string, number>();
  const existing = new Set((opts.existingBodies ?? []).map(normal));

  root.questions.forEach((item, i) => {
    const number = i + 1;
    const bad = (message: string) => out.problems.push({ number, message });
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return bad('This is not a question object.');
    }
    const q = item as Record<string, unknown>;
    const type = typeof q.type === 'string' ? q.type.trim().toUpperCase() : '';
    if (type !== 'SINGLE' && type !== 'MULTI' && type !== 'SUBJECTIVE') {
      return bad('The type must be SINGLE, MULTI or SUBJECTIVE.');
    }
    if (typeof q.body !== 'string') return bad('The question text is missing.');
    const text = (v: unknown) => (typeof v === 'string' ? cleanText(v) : undefined);

    let candidate: Record<string, unknown>;
    if (type === 'SUBJECTIVE') {
      candidate = {
        type,
        body: cleanText(q.body),
        marks: marks.written,
        explanation: text(q.explanation) || null,
        rubric: text(q.rubric) || null,
      };
    } else {
      if (!Array.isArray(q.options) || q.options.some((o) => typeof o !== 'string')) {
        return bad('The options must be a list of text.');
      }
      const options = (q.options as string[]).map(cleanText);
      if (options.length > maxOptions) {
        return bad(`There are ${options.length} options; the brief asked for ${maxOptions}.`);
      }
      if (new Set(options.map(normal)).size !== options.length) {
        return bad('Two options are the same.');
      }
      const letters = Array.isArray(q.correct) ? q.correct : q.correct != null ? [q.correct] : [];
      const indexes: number[] = [];
      for (const l of letters) {
        const letter = typeof l === 'string' ? l.trim().toUpperCase() : '';
        const at = /^[A-F]$/.test(letter) ? letter.charCodeAt(0) - 65 : -1;
        if (at < 0 || at >= options.length) {
          return bad(
            `The correct answer ${typeof l === 'string' ? l.trim() || '(empty)' : String(l)} does not exist; there are only ${options.length} options.`,
          );
        }
        indexes.push(at);
      }
      candidate = {
        type,
        body: cleanText(q.body),
        options,
        correctOptions: indexes,
        marks: type === 'SINGLE' ? marks.single : marks.multi,
        partialCredit: type === 'MULTI' ? partial : false,
        explanation: text(q.explanation) || null,
      };
    }

    const checked = questionInputSchema.safeParse(candidate);
    if (!checked.success) {
      return bad(checked.error.issues.map((x) => x.message).join('; '));
    }

    const topic = text(q.topic) ?? null;
    const diff = typeof q.difficulty === 'string' ? q.difficulty.trim().toUpperCase() : '';
    const difficulty: AiDifficulty | null =
      diff === 'EASY' || diff === 'MEDIUM' || diff === 'HARD' ? diff : null;

    const key = normal(checked.data.body);
    if (existing.has(key)) out.warnings.push(`Question ${number} is already in this exam.`);
    else if (seen.has(key))
      out.warnings.push(`Question ${number} repeats question ${seen.get(key)}.`);
    else seen.set(key, number);

    out.valid.push({ number, topic, difficulty, input: checked.data });
    out.byType[type]++;
    if (difficulty) out.byDifficulty[difficulty]++;
    if (topic) out.byTopic[topic] = (out.byTopic[topic] ?? 0) + 1;
  });

  if (opts.expected) out.warnings.push(...compareCounts(out, opts.expected));
  return out;
}

function compareCounts(got: AiPaperCheck, want: AiPromptPart): string[] {
  const w: string[] = [];
  const note = (label: string, asked: number, have: number) => {
    if (asked !== have) w.push(`${label}: asked ${asked}, got ${have}.`);
  };
  note('Questions', want.size, got.valid.length);
  note('Single-answer', want.types.single, got.byType.SINGLE);
  note('Multiple-answer', want.types.multi, got.byType.MULTI);
  note('Written', want.types.written, got.byType.SUBJECTIVE);
  note('Easy', want.difficulty.easy, got.byDifficulty.EASY);
  note('Medium', want.difficulty.medium, got.byDifficulty.MEDIUM);
  note('Hard', want.difficulty.hard, got.byDifficulty.HARD);
  const byName = new Map(Object.entries(got.byTopic).map(([k, v]) => [normal(k), v]));
  for (const t of want.topics) note(`Topic ${t.name}`, t.count, byName.get(normal(t.name)) ?? 0);
  return w;
}

// -------------------------------------------------------------- follow-up prompts

/** Asks the AI to correct only the questions that could not be imported. */
export function buildFixPrompt(problems: AiProblem[]): string {
  return [
    'Some of the questions you wrote had problems:',
    ...problems.map((p) => `- Question ${p.number}: ${p.message}`),
    '',
    `Return one JSON object in the same format ("schema": "${AI_PAPER_SCHEMA}") with only the corrected questions, in the same order. Reply with JSON only, inside a single \`\`\`json code block: no greeting and nothing outside the block.`,
  ].join('\n');
}

/** Asks the AI for the questions still missing, without repeating the ones already accepted. */
export function buildMissingPrompt(check: AiPaperCheck, want: AiPromptPart): string {
  const left = (asked: number, have: number) => Math.max(0, asked - have);
  const byName = new Map(Object.entries(check.byTopic).map(([k, v]) => [normal(k), v]));
  const missing = want.size - check.valid.length;
  const lines = [
    `You returned ${check.valid.length} usable questions of ${want.size}. Write the ${Math.max(0, missing)} that are still missing.`,
    '',
    'Still needed:',
    `- Single-answer: ${left(want.types.single, check.byType.SINGLE)}`,
    `- Multiple-answer: ${left(want.types.multi, check.byType.MULTI)}`,
    `- Written: ${left(want.types.written, check.byType.SUBJECTIVE)}`,
    `- Easy: ${left(want.difficulty.easy, check.byDifficulty.EASY)}, medium: ${left(want.difficulty.medium, check.byDifficulty.MEDIUM)}, hard: ${left(want.difficulty.hard, check.byDifficulty.HARD)}`,
    ...want.topics
      .map((t) => ({ t, n: left(t.count, byName.get(normal(t.name)) ?? 0) }))
      .filter((x) => x.n > 0)
      .map((x) => `- Topic ${x.t.name}: ${x.n}`),
    '',
    'Do not repeat these questions:',
    ...check.valid.map((q) => `- ${q.input.body.slice(0, 80)}`),
    '',
    `Use the same JSON format ("schema": "${AI_PAPER_SCHEMA}"). Reply with JSON only, inside a single \`\`\`json code block: no greeting and nothing outside the block.`,
  ];
  return lines.join('\n');
}
