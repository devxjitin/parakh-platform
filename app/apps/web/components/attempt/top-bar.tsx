'use client';

import type { AttemptDto } from '@parakh/shared';
import { Icon } from '../icons';
import { clock, type SaveState } from './helpers';

export function AttemptTopBar({
  attempt,
  number,
  saveState,
  remaining,
}: {
  attempt: AttemptDto;
  number: number;
  saveState: SaveState;
  remaining: number | null;
}) {
  return (
    <header className="attempt-topbar">
      <div className="attempt-title">
        <span className="attempt-title-dot" />
        <span>{attempt.exam.title}</span>
        <span className="attempt-crumb">
          Question {number} of {attempt.questions.length}
        </span>
      </div>
      <div className="attempt-stats">
        <span className="save-pill" role="status" aria-live="polite">
          <span
            className={`save-dot ${saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : ''}`}
          />
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'error'
              ? 'Offline, retrying…'
              : 'All saved'}
        </span>
        {attempt.strikePolicy !== 'OFF' && (
          <span className={`badge ${attempt.strikes > 0 ? 'badge-warn' : ''}`}>
            <Icon name="shield" size={14} />
            <span>
              Warnings {attempt.strikes}
              {attempt.strikePolicy === 'AUTO_SUBMIT' ? `/${attempt.maxStrikes}` : ''}
            </span>
          </span>
        )}
        <span
          className={`timer-chip ${remaining !== null && remaining < 300 ? 'timer-warn' : ''}`}
          role="timer"
          aria-live="off"
          aria-label={remaining === null ? 'Time left' : `Time left ${clock(remaining)}`}
        >
          <Icon name="clock" size={16} />
          <span>{remaining === null ? '--:--' : clock(remaining)}</span>
        </span>
      </div>
    </header>
  );
}
