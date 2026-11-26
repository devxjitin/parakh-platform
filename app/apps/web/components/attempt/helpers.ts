import type { AttemptAnswerDto } from '@parakh/shared';

export type SaveState = 'saved' | 'saving' | 'error';

export const TIMING_POLL_MS = 10_000;
export const TIMING_RECHECK_MS = 2_000;

export const END_TEXT: Record<string, string> = {
  SUBMITTED_BY_STUDENT: 'You submitted your exam.',
  TIME_UP: 'Time ran out, so your exam was submitted automatically.',
  STRIKES:
    'Your exam was submitted automatically after too many warnings for leaving the exam screen.',
};

export function clock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const isAnswered = (a?: AttemptAnswerDto) =>
  Boolean(a && (a.selected.length > 0 || a.text.trim()));
export const blank = (): AttemptAnswerDto => ({ selected: [], text: '', flagged: false });

export type NavMode = 'full' | 'slim' | 'hidden';
