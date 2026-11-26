'use client';

import type { RefObject } from 'react';
import type { AttemptAnswerDto, AttemptDto } from '@parakh/shared';
import { Icon } from '../icons';
import { isAnswered, type NavMode } from './helpers';

export function QuestionNavigator({
  attempt,
  answers,
  current,
  navMode,
  navOpen,
  answeredCount,
  progressPercent,
  navRef,
  setNavMode,
  setCurrent,
  setNavOpen,
}: {
  attempt: AttemptDto;
  answers: Record<string, AttemptAnswerDto>;
  current: number;
  navMode: NavMode;
  navOpen: boolean;
  answeredCount: number;
  progressPercent: number;
  navRef: RefObject<HTMLDivElement | null>;
  setNavMode: (mode: NavMode) => void;
  setCurrent: (index: number) => void;
  setNavOpen: (open: boolean) => void;
}) {
  return (
    <aside
      className={`card attempt-nav${navOpen ? ' open' : ''}`}
      id="question-navigator"
      aria-label="Question navigator"
    >
      <div className="nav-head">
        <h2 className="nav-title">Question navigator</h2>
        <div className="nav-tools">
          <button
            type="button"
            className="nav-toggle"
            onClick={() => setNavMode(navMode === 'slim' ? 'full' : 'slim')}
            aria-label={
              navMode === 'slim' ? 'Expand question navigator' : 'Make question navigator smaller'
            }
            title={navMode === 'slim' ? 'Expand' : 'Make smaller'}
          >
            <Icon name="panel" size={18} />
          </button>
          <button
            type="button"
            className="nav-toggle nav-hide"
            onClick={() => setNavMode('hidden')}
            aria-label="Hide question navigator"
            title="Hide"
          >
            <Icon name="chevron" size={18} />
          </button>
        </div>
      </div>
      <span className="nav-count" aria-hidden="true">
        {answeredCount}/{attempt.questions.length}
      </span>
      <div className="nav-progress">
        <div className="nav-progress-top">
          <span>
            {answeredCount} of {attempt.questions.length} answered
          </span>
          <b>{progressPercent}%</b>
        </div>
        <div className="q-progress">
          <div className="q-progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div
        className="q-nav-grid"
        ref={navRef}
        onKeyDown={(e) => {
          const keys: Record<string, number> = {
            ArrowRight: 1,
            ArrowDown: 5,
            ArrowLeft: -1,
            ArrowUp: -5,
          };
          const total = attempt.questions.length;
          let next = -1;
          if (e.key in keys) next = Math.min(total - 1, Math.max(0, current + keys[e.key]));
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = total - 1;
          if (next < 0) return;
          e.preventDefault();
          setCurrent(next);
          navRef.current?.querySelectorAll<HTMLElement>('button')[next]?.focus();
        }}
      >
        {attempt.questions.map((x, i) => {
          const ans = answers[x.id];
          const done = isAnswered(ans);
          const isCurrent = i === current;
          const isFlagged = Boolean(ans?.flagged);
          return (
            <button
              key={x.id}
              className={`q-nav-tile${done ? ' answered' : ''}${isCurrent ? ' current' : ''}${isFlagged ? ' flagged' : ''}`}
              aria-label={`Question ${x.number}${done ? ', answered' : ''}${isFlagged ? ', flagged' : ''}`}
              aria-current={isCurrent}
              tabIndex={isCurrent ? 0 : -1}
              onClick={() => {
                setCurrent(i);
                setNavOpen(false);
              }}
            >
              {x.number}
            </button>
          );
        })}
      </div>

      <div className="nav-legend">
        <div>
          <i className="lg-answered" />
          <span>Answered</span>
          <b>{answeredCount}</b>
        </div>
        <div>
          <i className="lg-flagged" />
          <span>Flagged for review</span>
          <b>{attempt.questions.filter((x) => answers[x.id]?.flagged).length}</b>
        </div>
        <div>
          <i className="lg-open" />
          <span>Not answered</span>
          <b>{attempt.questions.length - answeredCount}</b>
        </div>
      </div>
    </aside>
  );
}
