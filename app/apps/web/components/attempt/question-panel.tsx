'use client';

import type { AttemptAnswerDto, AttemptDto, SaveAnswerInput } from '@parakh/shared';
import { QuestionImage, QuestionText } from '../question-content';
import { Button } from '../ui';
import { Icon } from '../icons';
import type { NavMode } from './helpers';

export function QuestionPanel({
  attempt,
  q,
  a,
  isLast,
  current,
  answeredCount,
  navMode,
  setNavMode,
  change,
  setCurrent,
  setConfirmSubmit,
}: {
  attempt: AttemptDto;
  q: AttemptDto['questions'][number];
  a: AttemptAnswerDto;
  isLast: boolean;
  current: number;
  answeredCount: number;
  navMode: NavMode;
  setNavMode: (mode: NavMode) => void;
  change: (qid: string, patch: SaveAnswerInput) => void;
  setCurrent: (update: (c: number) => number) => void;
  setConfirmSubmit: (open: boolean) => void;
}) {
  return (
    <section className="card attempt-main">
      <div className="toolbar attempt-q-head">
        <div className="q-head-main">
          <span className="q-head-num">{q.number}</span>
          <div>
            <strong>
              Question {q.number} of {attempt.questions.length}
            </strong>
            <span className="q-head-meta">
              {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
              {q.type === 'MULTI' ? ' · Select all that apply' : ''}
            </span>
          </div>
        </div>
        <span className="spacer" />
        {navMode === 'hidden' && (
          <button
            type="button"
            className="nav-reopen"
            onClick={() => setNavMode('full')}
            aria-label="Show question navigator"
          >
            <Icon name="panel" size={16} />
            <span>
              Questions {answeredCount}/{attempt.questions.length}
            </span>
          </button>
        )}
        <Button
          variant={a.flagged ? 'primary' : 'secondary'}
          small
          onClick={() => change(q.id, { flagged: !a.flagged })}
        >
          {a.flagged ? 'Flagged for review' : 'Flag for review'}
        </Button>
      </div>

      <div className="attempt-scroll">
        <div
          className="q-body"
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: '1rem',
            lineHeight: 1.6,
          }}
        >
          <QuestionText text={q.body} markdown={q.markdown} />
          {q.imageAlt && (
            <QuestionImage
              path={`/attempts/${attempt.id}/questions/${q.id}/image`}
              alt={q.imageAlt}
            />
          )}
        </div>

        {q.type === 'SUBJECTIVE' ? (
          <div className="field">
            <textarea
              value={a.text}
              onChange={(e) => change(q.id, { text: e.target.value })}
              placeholder="Type your response here..."
              className="answer-area"
              maxLength={50_000}
            />
          </div>
        ) : (
          <div className="stack" style={{ marginTop: 12 }}>
            {q.options.map((o, i) => {
              const checked = a.selected.includes(o.id);
              return (
                <label className={`attempt-opt-card${checked ? ' selected' : ''}`} key={o.id}>
                  <input
                    type={q.type === 'SINGLE' ? 'radio' : 'checkbox'}
                    name={q.id}
                    checked={checked}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                    onChange={() =>
                      change(q.id, {
                        selected:
                          q.type === 'SINGLE'
                            ? [o.id]
                            : checked
                              ? a.selected.filter((x) => x !== o.id)
                              : [...a.selected, o.id],
                      })
                    }
                  />
                  <span className="opt-badge">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1, paddingTop: 2 }}>
                    <QuestionText text={o.text} markdown={q.markdown} />
                  </span>
                </label>
              );
            })}
            {a.selected.length > 0 && q.type === 'SINGLE' && (
              <div>
                <Button variant="secondary" small onClick={() => change(q.id, { selected: [] })}>
                  Clear answer
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="toolbar attempt-actions">
        <Button
          variant="secondary"
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
        >
          Previous
        </Button>
        <span className="spacer" />
        {isLast ? (
          <Button onClick={() => setConfirmSubmit(true)}>Submit exam</Button>
        ) : (
          <Button onClick={() => setCurrent((c) => c + 1)}>Next</Button>
        )}
      </div>
    </section>
  );
}
