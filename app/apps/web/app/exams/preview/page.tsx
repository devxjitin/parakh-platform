'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ExamPreviewDto } from '@parakh/shared';
import { QuestionImage, QuestionText } from '../../../components/question-content';
import { Alert, Shell, useQueryParam } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';

/** Shows the exam the way a student will see it. Nothing here can be submitted. */
export default function PreviewPage() {
  const { user, loading } = useRequireAuth();
  const id = useQueryParam('id');
  const [exam, setExam] = useState<ExamPreviewDto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id || (user?.role !== 'EXAMINER' && user?.role !== 'ADMIN')) return;
    api<ExamPreviewDto>(`/exams/${id}/preview`)
      .then(setExam)
      .catch(() => setError('Could not load the preview.'));
  }, [id, user]);

  if (loading || !user) {
    return (
      <Shell>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'EXAMINER' && user.role !== 'ADMIN') {
    return (
      <Shell>
        <Alert>Only trainers can preview exams.</Alert>
      </Shell>
    );
  }

  return (
    <Shell>
      <Alert kind="info">
        Preview only. This is what students will see; answers are not saved.
      </Alert>
      {error && <Alert>{error}</Alert>}
      {exam && (
        <div className="stack" style={{ marginTop: 16 }}>
          <section className="card">
            <h1>{exam.title}</h1>
            {exam.description && <p>{exam.description}</p>}
            <p className="muted">
              {exam.questions.length} questions, {exam.totalMarks} marks, {exam.durationMinutes}{' '}
              minutes, pass mark {exam.passPercent}%
            </p>
            {exam.instructions && <p style={{ whiteSpace: 'pre-wrap' }}>{exam.instructions}</p>}
          </section>
          {exam.questions.map((q) => (
            <section className="card" key={q.id}>
              <div className="toolbar">
                <strong>Question {q.position}</strong>
                <span className="muted">{q.marks} marks</span>
              </div>
              <div className="q-body" style={{ whiteSpace: 'pre-wrap' }}>
                <QuestionText text={q.body} markdown={q.markdown} />
                {q.imageAlt && (
                  <QuestionImage
                    path={`/exams/${exam.id}/questions/${q.id}/image`}
                    alt={q.imageAlt}
                  />
                )}
              </div>
              {q.type === 'SUBJECTIVE' ? (
                <textarea
                  disabled
                  placeholder="Students type their answer here"
                  style={{ width: '100%', minHeight: 100 }}
                />
              ) : (
                <div className="stack">
                  {q.type === 'MULTI' && <small className="muted">Select all that apply.</small>}
                  {q.options.map((o, i) => (
                    <label className="check q-item" key={i}>
                      <input type={q.type === 'SINGLE' ? 'radio' : 'checkbox'} disabled />{' '}
                      <span>
                        {String.fromCharCode(65 + i)}.{' '}
                        <QuestionText text={o} markdown={q.markdown} />
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ))}
          <Link href={`/exams/edit/?id=${exam.id}`}>Back to editing</Link>
        </div>
      )}
    </Shell>
  );
}
