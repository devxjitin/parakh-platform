'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { GradingAttemptDto, GradingQuestionDto } from '@parakh/shared';
import { QuestionImage, QuestionText } from '../../../components/question-content';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatusBadge,
  describeError,
  useQueryParam,
  Req,
} from '../../../components/ui';
import { MarkOverride } from '../../../components/mark-override';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';

const letter = (i: number) => String.fromCharCode(65 + i);
const END_TEXT: Record<string, string> = {
  SUBMITTED_BY_STUDENT: 'Submitted by the student',
  TIME_UP: 'Ended when time ran out',
  STRIKES: 'Auto-submitted after 3 strikes',
};

function WrittenAnswer({
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
  onSaved: () => Promise<void>;
}) {
  const [marks, setMarks] = useState(q.marksAwarded === null ? '' : String(q.marksAwarded));
  const [feedback, setFeedback] = useState(q.feedback ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = !q.text?.trim();

  async function save() {
    setError('');
    const n = Number(marks);
    if (marks.trim() === '' || Number.isNaN(n) || n < 0 || n > q.marks) {
      setError(`Enter marks between 0 and ${q.marks}.`);
      return;
    }
    setBusy(true);
    try {
      await api(`/exams/${examId}/attempts/${attemptId}/answers/${q.questionId}/grade`, {
        method: 'PUT',
        body: { marks: n, feedback: feedback.trim() || null },
      });
      await onSaved();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="q-body answer-box">
        {blank ? <em className="muted">No answer written.</em> : q.text}
      </div>
      {q.rubric && (
        <p className="muted" style={{ margin: 0 }}>
          <strong>Marking guide:</strong> <QuestionText text={q.rubric} markdown={q.markdown} />
        </p>
      )}
      {!blank && (
        <div className="row">
          <label className="field">
            <span>
              Marks (out of {q.marks})
              <Req />
            </span>
            <input
              type="number"
              min={0}
              max={q.marks}
              step="0.5"
              value={marks}
              disabled={locked}
              onChange={(e) => setMarks(e.target.value)}
            />
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}>
            <span>Feedback for the student</span>
            <input
              value={feedback}
              disabled={locked}
              maxLength={2000}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {!blank && !locked && (
        <div>
          <Button small loading={busy} onClick={save}>
            {q.marksAwarded === null ? 'Save marks' : 'Update marks'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function GradePage() {
  const { user, loading } = useRequireAuth();
  const examId = useQueryParam('exam');
  const attemptId = useQueryParam('attempt');
  const [data, setData] = useState<GradingAttemptDto | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!examId || !attemptId) return;
    try {
      setData(await api<GradingAttemptDto>(`/exams/${examId}/attempts/${attemptId}`));
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [examId, attemptId]);

  useEffect(() => {
    if (user?.role === 'EXAMINER' || user?.role === 'ADMIN') void load();
  }, [user, load]);

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
        <Alert>Only trainers can mark exams.</Alert>
      </Shell>
    );
  }

  const back = `/exams/edit/?id=${examId}`;
  if (error || !data) {
    return (
      <Shell wide>
        {error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>}
        <p>
          <Link href={back}>Back to the exam</Link>
        </p>
      </Shell>
    );
  }

  const pending = data.questions.filter(
    (q) => q.type === 'SUBJECTIVE' && q.marksAwarded === null,
  ).length;

  return (
    <Shell wide>
      <PageHeader
        title={data.studentName}
        subtitle={`${data.studentEmail}, ${END_TEXT[data.endReason ?? ''] ?? data.status}`}
      >
        <Link className="btn btn-secondary btn-link" href={back}>
          Back to results
        </Link>
      </PageHeader>

      <div className="stats">
        <div className="stat stat-hl">
          <div className="stat-top">
            <span>Score</span>
          </div>
          <div className="stat-value">
            {data.result ? `${data.result.score} / ${data.result.maxScore}` : 'N/A'}
          </div>
          <div className="stat-note">
            {data.result ? `${data.result.percent}%` : `${pending} answer(s) still to mark`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span>Result</span>
          </div>
          <div className="stat-value" style={{ fontSize: '1.3rem' }}>
            {data.result ? (
              <StatusBadge
                status={data.result.passed ? 'LIVE' : 'SUSPENDED'}
                label={data.result.passed ? 'Pass' : 'Fail'}
              />
            ) : (
              'N/A'
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat-top">
            <span>Strikes</span>
          </div>
          <div className="stat-value">{data.strikes}</div>
          <div className="stat-note">{data.events.length} proctor events</div>
        </div>
      </div>

      {data.finalized && <Alert kind="success">Results are published; marks are locked.</Alert>}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Integrity report</h2>
        {data.integrity.flags.length === 0 ? (
          <p className="muted">Nothing unusual was recorded for this attempt.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {data.integrity.flags.map((f) => (
              <li key={f.code}>{f.message}</li>
            ))}
          </ul>
        )}
        <dl className="kv">
          <dt>Started from</dt>
          <dd>{data.integrity.startIp ?? 'N/A'}</dd>
          <dt>Last seen at</dt>
          <dd>{data.integrity.lastIp ?? 'N/A'}</dd>
          <dt>Browser</dt>
          <dd>{data.integrity.userAgent ?? 'N/A'}</dd>
          {data.integrity.sharedWith.length > 0 && (
            <>
              <dt>Same device as</dt>
              <dd>{data.integrity.sharedWith.map((s) => `${s.name} (${s.email})`).join(', ')}</dd>
            </>
          )}
        </dl>
        <h3>Timeline</h3>
        <p className="muted">
          Reported by the student's browser and the server. Advisory, not proof of anything.
        </p>
        <ul className="muted" style={{ paddingLeft: 18 }}>
          {data.events.length === 0 && <li>No events</li>}
          {data.events.map((e, i) => (
            <li key={i}>
              {new Date(e.at).toLocaleTimeString()}, {e.type.replace(/_/g, ' ').toLowerCase()}
              {e.strike ? ', strike' : ''}
              {e.ip ? `, ${e.ip}` : ''}
            </li>
          ))}
        </ul>
      </section>

      {data.history.length > 0 && (
        <section className="card" style={{ marginBottom: 14 }}>
          <strong>History</strong>
          <ul>
            {data.history.map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleString()},{' '}
                {
                  {
                    ADD_TIME: `trainer added ${h.minutes} min`,
                    REOPEN: `trainer reopened the attempt for ${h.minutes} min`,
                    DEVICE_RELEASED: 'trainer released the device',
                    DEVICE_AUTO_RELEASED: 'device switched automatically (old one was silent)',
                  }[h.action]
                }
                {h.reason ? `, reason: ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.questions.map((q) => (
        <section className="card" key={q.questionId} style={{ marginBottom: 14 }}>
          <div className="toolbar">
            <strong>Question {q.number}</strong>
            <StatusBadge
              status=""
              label={
                q.type === 'SUBJECTIVE'
                  ? 'written'
                  : q.type === 'MULTI'
                    ? 'several correct'
                    : 'one correct'
              }
            />
            <span className="spacer" />
            <span className="muted">
              {q.marksAwarded === null ? 'Not marked' : `${q.marksAwarded} / ${q.marks}`}
            </span>
          </div>
          <p className="q-body" style={{ whiteSpace: 'pre-wrap' }}>
            <QuestionText text={q.body} markdown={q.markdown} />
          </p>
          {q.imageAlt && (
            <QuestionImage
              path={`/exams/${data.examId}/questions/${q.questionId}/image`}
              alt={q.imageAlt}
            />
          )}
          {q.type === 'SUBJECTIVE' ? (
            <WrittenAnswer
              q={q}
              examId={data.examId}
              attemptId={data.attemptId}
              locked={data.finalized}
              onSaved={load}
            />
          ) : (
            <ul className="q-options">
              {q.options.map((o, i) => {
                const right = q.correctOptions.includes(i);
                const chosen = q.selected.includes(i);
                return (
                  <li key={i} className={right ? 'correct' : chosen ? 'wrong' : ''}>
                    {letter(i)}. <QuestionText text={o} markdown={q.markdown} />
                    {chosen && <span className="muted"> (student's answer)</span>}
                    {right && !chosen && <span className="muted"> (correct answer)</span>}
                  </li>
                );
              })}
              {q.selected.length === 0 && <li className="muted">Not answered</li>}
            </ul>
          )}
          {(q.type === 'SINGLE' || q.type === 'MULTI') && (
            <MarkOverride
              q={q}
              examId={data.examId}
              attemptId={data.attemptId}
              locked={data.finalized}
              onSaved={load}
            />
          )}
        </section>
      ))}
    </Shell>
  );
}
