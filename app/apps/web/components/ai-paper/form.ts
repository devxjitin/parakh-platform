import { useState } from 'react';
import { LIMITS, aiBriefSchema, type AiBrief, type ExamDetailDto } from '@parakh/shared';

export interface TopicRow {
  name: string;
  notes: string;
  count: string;
}

export interface FormState {
  title: string;
  subject: string;
  topics: TopicRow[];
  total: number;
  single: number;
  multi: number;
  written: number;
  easy: number;
  medium: number;
  hard: number;
  /** How hard the whole paper is. The easy/medium/hard counts are derived from it. */
  level: Level;
  optionsPerQuestion: number;
  audience: string;
  language: string;
  includeExplanations: boolean;
  includeRubric: boolean;
  sourceMaterial: string;
  extraInstructions: string;
  avoid: string;
  marksSingle: number;
  marksMulti: number;
  marksWritten: number;
  partialCredit: boolean;
}

export type Level = 'easy' | 'medium' | 'hard';
export const LEVELS: { key: Level; label: string; hint: string }[] = [
  { key: 'easy', label: 'Easy', hint: 'Recall and basic ideas' },
  { key: 'medium', label: 'Medium', hint: 'Applying what was taught' },
  { key: 'hard', label: 'Hard', hint: 'Analysis and tricky cases' },
];

/** The whole paper has one difficulty, so every question falls in that level. */
export function levelCounts(level: Level, total: number) {
  return { easy: 0, medium: 0, hard: 0, [level]: total } as Record<Level, number>;
}

/** The level a saved brief mostly asks for. */
export function levelOf(d: { easy: number; medium: number; hard: number }): Level {
  return d.hard > d.medium && d.hard >= d.easy ? 'hard' : d.easy > d.medium ? 'easy' : 'medium';
}

export function fromBrief(brief: AiBrief): FormState {
  return {
    title: brief.title,
    subject: brief.subject,
    topics: brief.topics.map((t) => ({
      name: t.name,
      notes: t.notes ?? '',
      count: '',
    })),
    total: brief.total,
    single: brief.types.single,
    multi: brief.types.multi,
    written: brief.types.written,
    easy: brief.difficulty.easy,
    medium: brief.difficulty.medium,
    hard: brief.difficulty.hard,
    level: levelOf(brief.difficulty),
    optionsPerQuestion: brief.optionsPerQuestion,
    audience: brief.audience,
    language: 'English',
    includeExplanations: brief.includeExplanations,
    includeRubric: brief.includeRubric,
    sourceMaterial: brief.sourceMaterial ?? '',
    extraInstructions: brief.extraInstructions ?? '',
    avoid: brief.avoid ?? '',
    marksSingle: brief.marks.single,
    marksMulti: brief.marks.multi,
    marksWritten: brief.marks.written,
    partialCredit: true,
  };
}

/** With a paper plan, the marks for each type come from the plan and cannot be changed here. */
export function withPlanMarks(form: FormState, exam: ExamDetailDto): FormState {
  const plan = exam.paperPlan;
  if (!plan) return form;
  return {
    ...form,
    marksSingle: plan.singleMarks,
    marksMulti: plan.multiMarks,
    marksWritten: plan.subjectiveMarks,
  };
}

export function initialForm(exam: ExamDetailDto): FormState {
  const saved = aiBriefSchema.safeParse(exam.aiBrief ?? {});
  if (saved.success) return fromBrief(saved.data);
  const total = Math.min(10, LIMITS.MAX_QUESTIONS_PER_EXAM - exam.questionCount) || 1;
  return {
    title: exam.title,
    subject: '',
    topics: [],
    total,
    single: total,
    multi: 0,
    written: 0,
    ...levelCounts('medium', total),
    level: 'medium',
    optionsPerQuestion: 4,
    audience: '',
    language: 'English',
    includeExplanations: true,
    includeRubric: true,
    sourceMaterial: '',
    extraInstructions: '',
    avoid: '',
    marksSingle: 4,
    marksMulti: 4,
    marksWritten: 4,
    partialCredit: true,
  };
}

export function toInput(f: FormState) {
  return {
    title: f.title,
    subject: f.subject,
    topics: f.topics.map((t) => ({
      name: t.name,
      notes: t.notes || undefined,
      count: null,
    })),
    total: f.total,
    types: { single: f.single, multi: f.multi, written: f.written },
    difficulty: { easy: f.easy, medium: f.medium, hard: f.hard },
    optionsPerQuestion: f.optionsPerQuestion,
    audience: f.audience,
    language: 'English', // the paper is always in English
    includeExplanations: f.includeExplanations,
    includeRubric: f.includeRubric,
    sourceMaterial: f.sourceMaterial || undefined,
    extraInstructions: f.extraInstructions || undefined,
    avoid: f.avoid || undefined,
    marks: { single: f.marksSingle, multi: f.marksMulti, written: f.marksWritten },
    partialCredit: true,
  };
}

export function useCopy() {
  const [copied, setCopied] = useState('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setCopied('');
    }
  }
  return { copied, copy };
}

export const AI_SITES = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Gemini', 'https://gemini.google.com/'],
  ['Claude', 'https://claude.ai/'],
] as const;
