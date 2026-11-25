'use client';

import { useEffect, useState } from 'react';
import { REVIEW_PROMISE_HOURS, type StudentResultDto } from '@parakh/shared';
import { QuestionImage, QuestionText } from '../../components/question-content';
import {
  Alert,
  PageHeader,
  Shell,
  StatusBadge,
  describeError,
  useQueryParam,
} from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { WEBSITE_URL } from '../../lib/site';

const letter = (i: number) => String.fromCharCode(65 + i);

export default function ResultPage() {
  const { user, loading } = useRequireAuth();
  const id = useQueryParam('id');
  const [data, setData] = useState<StudentResultDto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id || user?.role !== 'STUDENT') return;
    api<StudentResultDto>(`/attempts/${id}/result`)
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 409
            ? `Your result is not ready yet. If your exam has written answers, a reviewer is marking them and the result is emailed to you within ${REVIEW_PROMISE_HOURS} hours of submitting.`
            : describeError(err).message,
        ),
      );
  }, [id, user]);

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'STUDENT') {
    return (
      <Shell wide>
        <Alert>Results are shown to students.</Alert>
      </Shell>
    );
  }
  if (error || !data) {
    return (
      <Shell wide>
        {error ? <Alert kind="info">{error}</Alert> : <p className="muted">Loading…</p>}
        <p>
          <a href={WEBSITE_URL}>Back to home</a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <PageHeader title={data.examTitle} subtitle="Your result">
        <a className="btn btn-secondary btn-link" href={WEBSITE_URL}>
          Back to home
        </a>
      </PageHeader>

      <div className="stats">
        <div className="stat stat-hl">
          <div className="stat-top">
            <span>Score</span>
          </div>
          <div className="stat-value">
            {data.score} / {data.maxScore}
          </div>
          <div className="stat-note">{data.percent}%</div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span>Outcome</span>
          </div>
          <div className="stat-value" style={{ fontSize: '1.3rem' }}>
            <StatusBadge
              status={data.passed ? 'LIVE' : 'SUSPENDED'}
              label={data.passed ? 'Passed' : 'Not passed'}
            />
          </div>
          <div className="stat-note">pass mark {data.passPercent}%</div>
        </div>
      </div>

      <h2>Review your answers</h2>
      {data.questions.map((q) => (
        <section className="card" key={q.number} style={{ marginBottom: 14 }}>
          <div className="toolbar">
            <strong>Question {q.number}</strong>
            <span className="spacer" />
            <span className="muted">
              {q.marksAwarded} / {q.marks}
            </span>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>
            <QuestionText text={q.body} markdown={q.markdown} />
          </p>
          {q.imageAlt && (
            <QuestionImage
              path={`/attempts/${data.attemptId}/questions/${q.questionId}/image`}
              alt={q.imageAlt}
            />
          )}
          {q.type === 'SUBJECTIVE' ? (
            <div className="stack">
              <div className="q-body answer-box">
                {q.text?.trim() ? q.text : <em className="muted">You did not write an answer.</em>}
              </div>
              {q.feedback && (
                <Alert kind="info">
                  <strong>Trainer feedback:</strong> {q.feedback}
                </Alert>
              )}
            </div>
          ) : (
            <ul className="q-options">
              {q.options.map((o, i) => {
                const right = q.correctOptions.includes(i);
                const chosen = q.selected.includes(i);
                return (
                  <li key={i} className={right ? 'correct' : chosen ? 'wrong' : ''}>
                    {letter(i)}. <QuestionText text={o} markdown={q.markdown} />
                    {chosen && <span className="muted"> (your answer)</span>}
                    {right && !chosen && <span className="muted"> (correct answer)</span>}
                  </li>
                );
              })}
              {q.selected.length === 0 && (
                <li className="muted">You did not answer this question.</li>
              )}
            </ul>
          )}
          {q.explanation && (
            <p className="muted" style={{ marginBottom: 0 }}>
              <strong>Explanation:</strong>{' '}
              <QuestionText text={q.explanation} markdown={q.markdown} />
            </p>
          )}
        </section>
      ))}
    </Shell>
  );
}
