/**
 * Bulk question import parser, ported from Exam Hall (legacy app.js `parseQuestionsTxt`).
 *
 * Supported layouts: "Question 1:", "Q1.", "1.", "1)"; options as "A.", "A)", "(A)" or bullets
 * ("- text"); correct answer via an "Answer: B" line (or "Answer: A, C" for multi-select) or an
 * inline marker such as "(Correct)", "[x]", "*".
 *
 * Differences from legacy: returns `correctOptions: number[]` and `type` (SINGLE / MULTI) so
 * multiple-choice questions are supported, and it no longer special-cases "CEH" headings.
 */

export interface ParsedQuestion {
  type: 'SINGLE' | 'MULTI';
  body: string;
  options: string[];
  correctOptions: number[];
  marks: number;
  explanation: string;
}

export interface ParseOptions {
  defaultMarks?: number;
}

interface Draft {
  body: string;
  options: string[];
  correct: Set<number>;
  explanation: string;
}

const Q_START = /^(?:###\s*)?(?:Question\s*#?\s*\d+[:.]?|Q\s*#?\s*\d+[:.]?|\d+[.)\-:])\s*(.*)$/i;
const EXPLICIT_Q = /^(?:###\s*)?(?:Question|Q)\s*#?\s*\d+[:.]?/i;
const NUMBERED = /^\d+[.)\-:]\s+/;
const OPT_LETTER = /^[\s\-*]*(?:\(?([A-Fa-f])[.)]|\(([A-Fa-f])\)|\[([A-Fa-f])\])\s*(.*)$/;
const OPT_BULLET = /^\s*[-*•]\s+(.*)$/;
const ANSWER =
  /^(?:Answer\s*(?:Key)?|Correct\s*(?:Answer|Option)?|Ans|Key)\s*[:=-]\s*(?:Options?\s*)?(.+)$/i;
const EXPLANATION = /^(?:Explanation|Exp|Reason|Note)\s*[:-]\s*/i;
const INLINE_CORRECT = /\((?:correct|answer)\)|\[(?:correct|answer|x|\*)\]|\s\*$/gi;
const HAS_INLINE_CORRECT = /\((?:correct|answer)\)|\[(?:correct|answer|x|\*)\]|\s\*$/i;

function answerTokensToIndexes(raw: string): number[] {
  const out: number[] = [];
  for (const tok of raw.split(/[\s,;&/]+|(?<=[A-Fa-f])(?=[A-Fa-f])/).filter(Boolean)) {
    const t = tok.replace(/[()[\].]/g, '').toUpperCase();
    if (/^[A-F]$/.test(t)) out.push(t.charCodeAt(0) - 65);
    else if (/^[1-6]$/.test(t)) out.push(parseInt(t, 10) - 1);
  }
  return out;
}

export function parseQuestionsTxt(rawText: string, opts: ParseOptions = {}): ParsedQuestion[] {
  if (!rawText || !rawText.trim()) return [];
  const marks = Number(opts.defaultMarks) || 4;

  const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
  const questions: ParsedQuestion[] = [];
  let cur: Draft | null = null;
  let optIdx = -1;
  let inOptions = false;

  const finalize = () => {
    if (!cur) return;
    const body = cur.body.trim();
    const options = cur.options.map((o) => o.trim()).filter(Boolean);
    if (options.length >= 2 && (body || options.length)) {
      let correct = [...cur.correct].filter((i) => i >= 0 && i < options.length).sort();
      if (correct.length === 0) correct = [0]; // legacy behaviour: default to option A
      questions.push({
        type: correct.length > 1 ? 'MULTI' : 'SINGLE',
        body,
        options,
        correctOptions: correct,
        marks,
        explanation: cur.explanation.trim(),
      });
    }
    cur = null;
    optIdx = -1;
    inOptions = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^[=\-_]{3,}$/.test(line) || /^###\s+(?!Question|Q\s*\d)/i.test(line)) continue;

    if (/^Options\s*:?$/i.test(line)) {
      inOptions = true;
      continue;
    }

    const ans = line.match(ANSWER);
    if (ans && !OPT_BULLET.test(line)) {
      if (cur) for (const i of answerTokensToIndexes(ans[1])) cur.correct.add(i);
      optIdx = -1;
      continue;
    }

    if (EXPLANATION.test(line)) {
      if (cur) cur.explanation = line.replace(EXPLANATION, '');
      optIdx = -1;
      continue;
    }

    const draft = cur as Draft | null;
    const startsQuestion =
      EXPLICIT_Q.test(line) || (NUMBERED.test(line) && (!draft || draft.options.length >= 2));
    if (startsQuestion) {
      finalize();
      const m = line.match(Q_START);
      cur = { body: m ? m[1].trim() : '', options: [], correct: new Set(), explanation: '' };
      optIdx = -1;
      inOptions = false;
      continue;
    }

    const letter = line.match(OPT_LETTER);
    const bullet = inOptions || (draft && draft.options.length > 0) ? line.match(OPT_BULLET) : null;
    if ((letter || bullet) && cur) {
      let text = (letter ? letter[4] : bullet![1]).trim();
      const marked = HAS_INLINE_CORRECT.test(text) || line.startsWith('*');
      if (marked) text = text.replace(INLINE_CORRECT, '').trim();
      cur.options.push(text);
      optIdx = cur.options.length - 1;
      if (marked) cur.correct.add(optIdx);
      continue;
    }

    if (cur && line) {
      if (optIdx >= 0) {
        cur.options[optIdx] += ' ' + line;
      } else if (cur.options.length === 0 && !inOptions) {
        cur.body = cur.body ? `${cur.body}\n${line}` : line;
      }
    }
  }

  finalize();
  return questions;
}
