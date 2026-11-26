'use client';

import type { AttemptDto } from '@parakh/shared';

export function MobileBar({
  attempt,
  answeredCount,
  isLast,
  navOpen,
  setNavOpen,
  setCurrent,
  setConfirmSubmit,
}: {
  attempt: AttemptDto;
  answeredCount: number;
  isLast: boolean;
  navOpen: boolean;
  setNavOpen: (update: boolean | ((open: boolean) => boolean)) => void;
  setCurrent: (update: (c: number) => number) => void;
  setConfirmSubmit: (open: boolean) => void;
}) {
  return (
    <div className="attempt-mobilebar">
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={navOpen}
        aria-controls="question-navigator"
        onClick={() => setNavOpen((o) => !o)}
      >
        Questions {answeredCount}/{attempt.questions.length}
      </button>
      {isLast ? (
        <button type="button" className="btn btn-primary" onClick={() => setConfirmSubmit(true)}>
          Submit exam
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setCurrent((c) => c + 1);
            setNavOpen(false);
          }}
        >
          Next
        </button>
      )}
    </div>
  );
}
