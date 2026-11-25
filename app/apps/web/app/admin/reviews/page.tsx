'use client';

import { COPY } from '../../../lib/copy';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { REVIEW_PROMISE_HOURS, type ReviewQueueDto } from '@parakh/shared';
import { Alert, PageHeader, Shell, StatusBadge, describeError } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';

/** Always-open exams: written answers waiting for an admin. Each result is emailed when its last answer is marked. */
export default function AdminReviewsPage() {
  const { user, loading } = useRequireAuth();
  const [queue, setQueue] = useState<ReviewQueueDto | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setQueue(await api<ReviewQueueDto>('/admin/reviews'));
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [user, load]);

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'ADMIN') {
    return (
      <Shell wide>
        <Alert>Only NandiVex Technologies admins can open this page.</Alert>
      </Shell>
    );
  }

  const items = queue?.items ?? [];
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <Shell wide>
      <PageHeader
        title="Answers to review"
        subtitle={`Students of always-open exams are promised a result within ${REVIEW_PROMISE_HOURS} hours of submitting. Their result is emailed as soon as you mark the last written answer.`}
      >
        <Link className="btn btn-secondary btn-link" href="/admin/">
          Back to admin
        </Link>
      </PageHeader>

      {error && <Alert>{error}</Alert>}
      {overdue > 0 && (
        <Alert>
          {overdue} {overdue === 1 ? 'review is' : 'reviews are'} past {REVIEW_PROMISE_HOURS} hours.
          Mark them first.
        </Alert>
      )}

      {queue === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Nothing is waiting. New submissions with written answers will appear here.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Submitted</th>
                  <th>To mark</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.attemptId}>
                    <td>
                      <strong>{i.studentName}</strong>
                      <div className="muted">{i.studentEmail}</div>
                    </td>
                    <td>{i.examTitle}</td>
                    <td>
                      {new Date(i.submittedAt).toLocaleString()}{' '}
                      {i.overdue && <StatusBadge status="SUSPENDED" label="Overdue" />}
                    </td>
                    <td>
                      {i.pendingAnswers} {i.pendingAnswers === 1 ? 'answer' : 'answers'}
                    </td>
                    <td>
                      <Link
                        className="btn btn-secondary btn-link"
                        href={`/exams/grade/?exam=${i.examId}&attempt=${i.attemptId}`}
                      >
                        {COPY.markAnswers}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Shell>
  );
}
