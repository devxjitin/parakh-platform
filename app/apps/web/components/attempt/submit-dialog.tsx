'use client';

import type { RefObject } from 'react';
import type { AttemptAnswerDto, AttemptDto } from '@parakh/shared';
import { Button } from '../ui';

export function SubmitDialog({
  attempt,
  answers,
  answeredCount,
  submitting,
  modalRef,
  submit,
  setConfirmSubmit,
}: {
  attempt: AttemptDto;
  answers: Record<string, AttemptAnswerDto>;
  answeredCount: number;
  submitting: boolean;
  modalRef: RefObject<HTMLDivElement | null>;
  submit: () => Promise<void> | void;
  setConfirmSubmit: (open: boolean) => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submit-title">
      <div className="modal-card" ref={modalRef}>
        <h2 id="submit-title" style={{ marginTop: 0, fontSize: '1.25rem' }}>
          Submit your exam?
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.94rem', lineHeight: 1.55 }}>
          You have answered{' '}
          <strong>
            {answeredCount} of {attempt.questions.length}
          </strong>{' '}
          questions
          {attempt.questions.some((x) => answers[x.id]?.flagged)
            ? ' and some questions are flagged for review'
            : ''}
          . You cannot change your answers after submitting.
        </p>
        <div className="toolbar" style={{ marginTop: 20 }}>
          <Button loading={submitting} onClick={() => void submit()}>
            Yes, submit exam
          </Button>
          <Button variant="secondary" onClick={() => setConfirmSubmit(false)}>
            Keep working
          </Button>
        </div>
      </div>
    </div>
  );
}
