'use client';

import { useState } from 'react';
import type { GradingQuestionDto } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, describeError } from './ui';

/** Lets the trainer set one choice answer's mark by hand, with a reason, before results go out. */
export function MarkOverride({
  q,
  examId,
  attemptId,
  locked,
  onSaved,
}: {
  q: GradingQuestionDto;
  examId: string;
  attemptId: string;
  locked: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [marks, setMarks] = useState(q.override ? String(q.override.marks) : '');
  const [reason, setReason] = useState(q.override?.reason ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.dropped) {
    return <p className="muted">This question was dropped, so everyone has full marks.</p>;
  }
  if (locked) {
    return q.override ? (
      <p className="muted">
        Mark set by hand: {q.override.marks} ({q.override.reason})
      </p>
    ) : null;
  }

  async function save(clear: boolean) {
    setBusy(true);
    setError('');
    try {
      await api(`/exams/${examId}/attempts/${attemptId}/answers/${q.questionId}/override`, {
        method: 'PUT',
        body: clear ? { marks: null } : { marks: Number(marks), reason: reason.trim() },
      });
      if (clear) {
        setMarks('');
        setReason('');
      }
      await onSaved();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details style={{ marginTop: 8 }}>
      <summary>{q.override ? 'Mark set by hand' : 'Set the mark by hand'}</summary>
      {error && <Alert>{error}</Alert>}
      <div className="toolbar" style={{ marginTop: 8 }}>
        <input
          type="number"
          min={0}
          max={q.marks}
          step="0.5"
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
          aria-label="Marks"
          style={{ width: 90 }}
        />
        <input
          placeholder="Reason (at least 5 characters)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <Button
          small
          loading={busy}
          disabled={marks === '' || reason.trim().length < 5}
          onClick={() => void save(false)}
        >
          Save
        </Button>
        {q.override && (
          <Button variant="secondary" small loading={busy} onClick={() => void save(true)}>
            Back to automatic
          </Button>
        )}
      </div>
    </details>
  );
}
