'use client';

import { useState } from 'react';
import type { CorrectionResultDto, ExamDetailDto, ExamQuestionDto } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, describeError } from './ui';
import { promptDialog } from './dialogs';

const letter = (i: number) => String.fromCharCode(65 + i);

/** Fixes to a published exam: wording, answer key and dropping a question. */
export function CorrectionsPanel({
  exam,
  reload,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  if (exam.status !== 'PUBLISHED') return null;

  async function run(id: string, fn: () => Promise<string>) {
    setBusy(id);
    setError('');
    setNote('');
    try {
      setNote(await fn());
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  function askReason(what: string): Promise<string | null> {
    return promptDialog(what, {
      label: 'Why? (kept in the audit log, at least 5 characters)',
      minLength: 5,
    });
  }

  async function fixKey(q: ExamQuestionDto) {
    const answer = await promptDialog(
      q.options.map((o, i) => `${letter(i)}. ${o}`).join('\n') +
        '\n\nEvery student who finished is marked again with the new key.',
      {
        title: 'Change the answer key',
        label: `Correct option letters, for example ${q.type === 'MULTI' ? 'A, C' : 'B'}`,
        singleLine: true,
      },
    );
    if (!answer) return;
    const picks = answer
      .toUpperCase()
      .split(/[^A-F]+/)
      .filter(Boolean)
      .map((c) => c.charCodeAt(0) - 65);
    if (picks.length === 0 || picks.some((i) => i >= q.options.length)) {
      setError('Those are not valid options for this question.');
      return;
    }
    const reason = await askReason('Change the answer key?');
    if (!reason) return;
    await run(q.id, async () => {
      const r = await api<CorrectionResultDto>(`/exams/${exam.id}/questions/${q.id}/answer-key`, {
        method: 'PUT',
        body: { correctOptions: picks, reason },
      });
      return `Answer key changed. ${r.regraded} student(s) were marked again.`;
    });
  }

  async function drop(q: ExamQuestionDto) {
    const dropped = !q.dropped;
    const reason = await askReason(
      dropped
        ? 'Drop this question? Every student gets its full marks.'
        : 'Bring this question back? Marks return to what students answered.',
    );
    if (!reason) return;
    await run(q.id, async () => {
      const r = await api<CorrectionResultDto>(`/exams/${exam.id}/questions/${q.id}/dropped`, {
        method: 'PUT',
        body: { dropped, reason },
      });
      return `${dropped ? 'Dropped' : 'Restored'}. ${r.regraded} student(s) were marked again.`;
    });
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Fix a published exam</h2>
      <p className="muted">
        You can correct wording, change an answer key, or drop a question until you publish results.
        Options cannot be added or removed.
      </p>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {exam.questions.map((q) => (
        <div key={q.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <div className="toolbar">
            <strong>
              {q.position}. {q.body.length > 90 ? q.body.slice(0, 90) + '…' : q.body}
            </strong>
            {q.dropped && <span className="badge badge-danger">dropped</span>}
            {q.revision > 0 && <span className="muted">corrected {q.revision}×</span>}
          </div>
          {editing === q.id ? (
            <TextEditor
              q={q}
              onCancel={() => setEditing(null)}
              onSave={(patch, reason) =>
                run(q.id, async () => {
                  await api(`/exams/${exam.id}/questions/${q.id}/correction`, {
                    method: 'PATCH',
                    body: { ...patch, reason },
                  });
                  setEditing(null);
                  return 'Wording corrected.';
                })
              }
            />
          ) : (
            <div className="toolbar" style={{ marginTop: 6 }}>
              <Button variant="secondary" small onClick={() => setEditing(q.id)}>
                Fix wording
              </Button>
              {(q.type === 'SINGLE' || q.type === 'MULTI') && (
                <Button
                  variant="secondary"
                  small
                  loading={busy === q.id}
                  onClick={() => void fixKey(q)}
                >
                  Fix answer key
                </Button>
              )}
              <Button
                variant={q.dropped ? 'secondary' : 'danger'}
                small
                loading={busy === q.id}
                onClick={() => void drop(q)}
              >
                {q.dropped ? 'Bring back' : 'Drop question'}
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function TextEditor({
  q,
  onSave,
  onCancel,
}: {
  q: ExamQuestionDto;
  onSave: (
    patch: { body: string; options?: string[]; explanation?: string | null },
    reason: string | undefined,
  ) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(q.body);
  const [options, setOptions] = useState(q.options);
  const [explanation, setExplanation] = useState(q.explanation ?? '');
  const [reason, setReason] = useState('');
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ width: '100%', minHeight: 80, font: 'inherit', padding: 8 }}
      />
      {options.map((o, i) => (
        <input
          key={i}
          aria-label={`Option ${letter(i)}`}
          value={o}
          onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <input
        placeholder="Explanation"
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
      />
      <input
        placeholder="What was wrong? (kept in the audit log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="toolbar">
        <Button
          small
          onClick={() =>
            onSave(
              {
                body,
                ...(q.options.length ? { options } : {}),
                explanation: explanation.trim() || null,
              },
              reason.trim().length >= 5 ? reason.trim() : undefined,
            )
          }
        >
          Save wording
        </Button>
        <Button variant="secondary" small onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
