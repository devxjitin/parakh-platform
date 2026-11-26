'use client';

import { useState } from 'react';
import { QUESTION_TYPE_LABELS, type ExamDetailDto, type ExamQuestionDto } from '@parakh/shared';
import { AiPaperBuilder } from '../ai-paper-builder';
import { Icon, type IconName } from '../icons';
import { PlanProgress } from '../plan-progress';
import { QuestionEditor } from '../question-editor';
import { QuestionImage, QuestionText } from '../question-content';
import { Alert, Button, describeError } from '../ui';
import { api } from '../../lib/api';
import { confirmDialog } from '../dialogs';
import { PasteQuestions } from './paste-questions';

export const TYPE_LABEL = QUESTION_TYPE_LABELS;

export interface ImportResult {
  committed: boolean;
  found: number;
  importable: number;
  questions: { type: string; body: string; options: string[]; correctOptions: number[] }[];
}

export type AddMode = 'write' | 'paste' | 'ai';

export const ADD_MODES: { key: AddMode; icon: IconName; title: string; text: string }[] = [
  { key: 'write', icon: 'edit', title: 'Write a question', text: 'Add one question at a time' },
  { key: 'paste', icon: 'upload', title: 'Paste as text', text: 'Import many from plain text' },
  { key: 'ai', icon: 'sparkles', title: 'Build with AI', text: 'Describe a paper, get questions' },
];

export function QuestionsTab({
  exam,
  reload,
  locked,
  onGoToPlan,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  locked: boolean;
  onGoToPlan?: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // The question being written in the add editor (it exists as soon as it is valid).
  const [liveId, setLiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<AddMode | null>(null);
  const [error, setError] = useState('');
  const base = `/exams/${exam.id}`;

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  const move = (index: number, delta: number) => {
    const ids = exam.questions.map((q) => q.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run(() => api(`${base}/questions-order`, { method: 'PUT', body: { questionIds: ids } }));
  };

  return (
    <div>
      {error && <Alert>{error}</Alert>}
      <PlanProgress exam={exam} />
      {!locked && (
        <section className="add-panel" aria-label="Add questions">
          <div className="add-head">
            <h2>Add questions</h2>
            <p className="muted">
              Write them yourself, paste many at once, or build a whole paper with AI.
            </p>
          </div>
          <div className="add-options" role="group" aria-label="How to add questions">
            {ADD_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`add-option${mode === m.key ? ' on' : ''}`}
                aria-pressed={mode === m.key}
                onClick={() => setMode(mode === m.key ? null : m.key)}
              >
                <span className="add-option-ico">
                  <Icon name={m.icon} size={20} />
                </span>
                <span>
                  <b>{m.title}</b>
                  <small>{m.text}</small>
                </span>
              </button>
            ))}
          </div>
          {mode === 'write' && (
            <div className="add-body">
              <QuestionEditor
                examId={exam.id}
                plan={exam.paperPlan}
                onDone={() => {
                  setMode(null);
                  setLiveId(null);
                }}
                onSave={async (input, id) => {
                  const q = id
                    ? await api<ExamQuestionDto>(`${base}/questions/${id}`, {
                        method: 'PUT',
                        body: input,
                      })
                    : await api<ExamQuestionDto>(`${base}/questions`, {
                        method: 'POST',
                        body: input,
                      });
                  // The open editor now owns this question, so the list does not show it twice.
                  setLiveId(q.id);
                  await reload();
                  return q.id;
                }}
              />
            </div>
          )}
          {mode === 'paste' && (
            <div className="add-body">
              <PasteQuestions exam={exam} reload={reload} />
            </div>
          )}
          {mode === 'ai' && (
            <div className="add-body">
              <AiPaperBuilder exam={exam} reload={reload} onGoToPlan={onGoToPlan} />
            </div>
          )}
        </section>
      )}
      {exam.questions.map((q: ExamQuestionDto, i) =>
        q.id === liveId && mode === 'write' ? null : editing === q.id ? (
          <QuestionEditor
            key={q.id}
            initial={q}
            examId={exam.id}
            plan={exam.paperPlan}
            onDone={() => setEditing(null)}
            onSave={async (input) => {
              await api(`${base}/questions/${q.id}`, { method: 'PUT', body: input });
              await reload();
              return q.id;
            }}
          />
        ) : (
          <div className="q-item" key={q.id}>
            <div className="toolbar">
              <strong>Q{q.position}</strong>
              <span className="badge">{TYPE_LABEL[q.type]}</span>
              <span className="muted">{q.marks} marks</span>
              <span className="spacer" />
              {!locked && (
                <>
                  <Button
                    variant="secondary"
                    small
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={i === exam.questions.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <Button variant="secondary" small onClick={() => setEditing(q.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    small
                    onClick={async () => {
                      const ok = await confirmDialog(`Delete question ${q.position}?`, {
                        title: 'Delete question',
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (ok)
                        await run(() => api(`${base}/questions/${q.id}`, { method: 'DELETE' }));
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
            <div className="q-body">
              <QuestionText text={q.body} markdown={q.markdown} />
              {q.imageAlt && (
                <QuestionImage path={`${base}/questions/${q.id}/image`} alt={q.imageAlt} />
              )}
            </div>
            {q.options.length > 0 && (
              <ul className="q-options">
                {q.options.map((o, idx) => (
                  <li key={idx} className={q.correctOptions.includes(idx) ? 'correct' : ''}>
                    {String.fromCharCode(65 + idx)}. <QuestionText text={o} markdown={q.markdown} />
                  </li>
                ))}
              </ul>
            )}
            {q.rubric && (
              <p className="muted">
                Guidance: <QuestionText text={q.rubric} markdown={q.markdown} />
              </p>
            )}
            {q.explanation && (
              <p className="muted">
                Explanation: <QuestionText text={q.explanation} markdown={q.markdown} />
              </p>
            )}
          </div>
        ),
      )}
      {exam.questions.length === 0 && (
        <p className="muted">
          {locked
            ? 'This exam has no questions.'
            : 'No questions yet. Choose how to add them above.'}
        </p>
      )}
    </div>
  );
}
