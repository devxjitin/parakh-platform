'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExamDetailDto, RosterRowDto } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, describeError } from './ui';

/** Extra time (an accommodation) for students who have not started the exam yet. */
export function ExtraTimePanel({ exam }: { exam: ExamDetailDto }) {
  const [rows, setRows] = useState<RosterRowDto[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await api<RosterRowDto[]>(`/exams/${exam.id}/roster`);
      setRows(data);
      setValues(Object.fromEntries(data.map((r) => [r.enrollmentId, String(r.extraMinutes)])));
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [exam.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (exam.status !== 'PUBLISHED') return null;
  const waiting = rows?.filter((r) => !r.started) ?? [];
  if (waiting.length === 0) return null;

  async function save(r: RosterRowDto) {
    setBusy(r.enrollmentId);
    setError('');
    try {
      await api(`/exams/${exam.id}/enrollments/${r.enrollmentId}/extra-minutes`, {
        method: 'PUT',
        body: { minutes: Number(values[r.enrollmentId] || 0) },
      });
      await load();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Extra time for students who have not started</h3>
      <p className="muted">
        Added to the exam duration when the student starts, for example for a disability
        accommodation.
      </p>
      {error && <Alert>{error}</Alert>}
      {waiting.map((r) => (
        <div className="toolbar" key={r.enrollmentId} style={{ marginBottom: 6 }}>
          <span style={{ minWidth: 220 }}>
            {r.name} <span className="muted">{r.email}</span>
          </span>
          <input
            type="number"
            min={0}
            max={240}
            value={values[r.enrollmentId] ?? '0'}
            onChange={(e) => setValues({ ...values, [r.enrollmentId]: e.target.value })}
            aria-label={`Extra minutes for ${r.name}`}
            style={{ width: 80 }}
          />
          <span className="muted">min</span>
          <Button
            variant="secondary"
            small
            loading={busy === r.enrollmentId}
            onClick={() => void save(r)}
          >
            Save
          </Button>
        </div>
      ))}
    </section>
  );
}
