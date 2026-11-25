'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ExamSummaryDto } from '@parakh/shared';
import { Alert, Button, PageHeader, Shell, StatusBadge, describeError } from '../../components/ui';
import { api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';

export default function ExamsPage() {
  const { user, loading } = useRequireAuth();
  const [exams, setExams] = useState<ExamSummaryDto[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'EXAMINER' && user?.role !== 'ADMIN') return;
    api<ExamSummaryDto[]>('/exams')
      .then(setExams)
      .catch(() => setError('Could not load your exams.'));
  }, [user]);

  async function duplicate(id: string) {
    setError('');
    try {
      const copy = await api<{ id: string }>(`/exams/${id}/duplicate`, { method: 'POST' });
      window.location.href = `/exams/edit/?id=${copy.id}`;
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'EXAMINER' && user.role !== 'ADMIN') {
    return (
      <Shell wide>
        <Alert>Only trainers can build exams.</Alert>
      </Shell>
    );
  }

  const examTable = (rows: ExamSummaryDto[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Questions</th>
            <th>Students joined</th>
            <th>Total marks</th>
            <th>Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>{e.title}</td>
              <td>
                <StatusBadge status={e.status} />
              </td>
              <td>{e.questionCount}</td>
              <td>{e.joinedCount ?? 0}</td>
              <td>{e.totalMarks}</td>
              <td>{e.durationMinutes} min</td>
              <td>
                <div className="toolbar">
                  <Link
                    className="btn btn-secondary btn-small btn-link"
                    href={`/exams/edit/?id=${e.id}`}
                  >
                    Open
                  </Link>
                  <Button variant="secondary" small onClick={() => void duplicate(e.id)}>
                    Duplicate
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Shell wide>
      <PageHeader title="Exams" subtitle="Build exams, add questions and share them with students.">
        {user.role === 'ADMIN' && (
          <Link className="btn btn-secondary btn-link" href="/exams/new/?kind=always-open">
            New always-open exam
          </Link>
        )}
        <Link className="btn btn-primary btn-link" href="/exams/new/">
          {user.role === 'ADMIN' ? 'New scheduled exam' : 'New exam'}
        </Link>
      </PageHeader>
      {error && <Alert>{error}</Alert>}
      <section className="card">
        {exams === null && !error && <p className="muted">Loading…</p>}
        {exams?.length === 0 && (
          <div className="empty">
            <strong>No exams yet</strong>
            Create one to start adding questions.
          </div>
        )}
        {exams && exams.length > 0 && user.role === 'ADMIN' && (
          <>
            <h3 style={{ marginTop: 0 }}>Always-open exams</h3>
            {exams.some((e) => e.alwaysOpen) ? (
              examTable(exams.filter((e) => e.alwaysOpen))
            ) : (
              <p className="muted">None yet. Use New always-open exam.</p>
            )}
            <h3>Scheduled exams</h3>
            {exams.some((e) => !e.alwaysOpen) ? (
              examTable(exams.filter((e) => !e.alwaysOpen))
            ) : (
              <p className="muted">None yet.</p>
            )}
          </>
        )}
        {exams && exams.length > 0 && user.role !== 'ADMIN' && examTable(exams)}
      </section>
    </Shell>
  );
}
