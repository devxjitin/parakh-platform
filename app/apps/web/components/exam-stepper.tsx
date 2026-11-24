'use client';

import { Icon } from './icons';

export interface WizardStep {
  key: string;
  label: string;
  hint?: string;
}

/** The whole "create a paper" journey, in order. Shared by the New exam and Edit exam pages. */
export const PAPER_STEPS: WizardStep[] = [
  { key: 'basics', label: 'Basics', hint: 'Title & timing' },
  { key: 'logo', label: 'Logo', hint: 'Your branding' },
  { key: 'certificate', label: 'Certificate', hint: 'Design & rules' },
  { key: 'plan', label: 'Paper plan', hint: 'Size & sections' },
  { key: 'questions', label: 'Questions', hint: 'Add the paper' },
  { key: 'payment', label: 'Payment', hint: 'Who pays' },
  { key: 'publish', label: 'Publish', hint: 'Go live' },
];

/**
 * Numbered step bar: done steps get a tick, the current one is highlighted, the rest are greyed.
 * `canSelect` decides which steps can be clicked (omit `onSelect` for a read-only bar).
 */
export function ExamStepper({
  steps = PAPER_STEPS,
  current,
  onSelect,
  canSelect,
}: {
  steps?: WizardStep[];
  current: string;
  onSelect?: (key: string) => void;
  canSelect?: (key: string, index: number) => boolean;
}) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === current),
  );

  return (
    <nav aria-label="Paper creation steps">
      <ol className="stepper">
        {steps.map((s, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
          const clickable = !!onSelect && i !== currentIndex && (canSelect?.(s.key, i) ?? true);
          const body = (
            <>
              <span className="stepper-dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="stepper-text">
                <b>{s.label}</b>
                {s.hint && <small>{s.hint}</small>}
              </span>
            </>
          );
          return (
            <li
              key={s.key}
              className={`stepper-item stepper-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {clickable ? (
                <button type="button" className="stepper-btn" onClick={() => onSelect?.(s.key)}>
                  {body}
                </button>
              ) : (
                <span className="stepper-btn">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
