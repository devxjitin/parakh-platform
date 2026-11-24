'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  FLAG_TEXT,
  RESULT_RELEASE_DELAY_MIN,
  type ExamDetailDto,
  type ExamResultsDto,
  type IntegrityFlagCode,
} from '@parakh/shared';
import { api, apiBlob } from '../lib/api';
import { Alert, Button, StatCard, StatusBadge, describeError } from './ui';
import { confirmDialog, promptDialog } from './dialogs';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'N/A');

function rowStatus(r: ExamResultsDto['rows'][number]) {
  if (r.status === 'IN_PROGRESS') return <StatusBadge status="LIVE" label="Taking exam" />;
  if (r.pendingGrading > 0) {
    return <StatusBadge status="PAYMENT_PENDING" label={`${r.pendingGrading} to mark`} />;
  }
  if (r.status === 'RESULT_PUBLISHED')
    return <StatusBadge status="RESULTS_FINAL" label="Published" />;
  return <StatusBadge status="PUBLISHED" label="Marked" />;
}

const FLAG_LABEL: Record<IntegrityFlagCode, { text: string; kind: string }> = {
  DEVICE_MISMATCH: { text: 'Other device blocked', kind: 'danger' },
  SHARED_DEVICE: { text: 'Shared device', kind: 'warn' },
  NETWORK_CHANGED: { text: 'Network changed', kind: 'info' },
  NO_DEVICE_ID: { text: 'No device id', kind: 'warn' },
};

export function FlagBadges({ flags }: { flags: IntegrityFlagCode[] }) {
  if (flags.length === 0) return <span className="muted">N/A</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {flags.map((f) => (
        <span key={f} className={`badge badge-${FLAG_LABEL[f].kind}`} title={FLAG_TEXT[f]}>
          {FLAG_LABEL[f].text}
        </span>
      ))}
    </span>
  );
}

export function ResultsPanel({
  exam,
  reload,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
}) {
  const [data, setData] = useState<ExamResultsDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<ExamResultsDto>(`/exams/${exam.id}/results`));
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [exam.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    if (
      !(await confirmDialog(
        'Publish results now? Every student who has not been emailed yet gets one email with their score, certificate (if you give one) and answer sheet. Marks can no longer be changed.',
        { title: 'Publish results', confirmLabel: 'Publish' },
      ))
    )
      return;
    setBusy(true);
    setError('');
    try {
      setData(await api<ExamResultsDto>(`/exams/${exam.id}/finalize`, { method: 'POST' }));
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  /** Add time to a running attempt, or reopen a finished one. Both ask for minutes and a reason. */
  async function adjust(attemptId: string, name: string, kind: 'add-time' | 'reopen') {
    const asked = await promptDialog(
      kind === 'add-time'
        ? `How many minutes to add for ${name}?`
        : `Reopen ${name}'s attempt for how many minutes? Written and code marks for this student are cleared, because they may change their answers.`,
      {
        title: kind === 'add-time' ? 'Add time' : 'Reopen attempt',
        label: 'Minutes',
        singleLine: true,
        defaultValue: kind === 'add-time' ? '10' : '30',
      },
    );
    const minutes = Number(asked);
    if (asked === null || !Number.isFinite(minutes) || minutes < 1) return;
    const reason = await promptDialog('This is kept on the record.', {
      title: 'Why?',
      label: 'Reason (at least 5 characters)',
      minLength: 5,
    });
    if (!reason) return;
    try {
      await api(`/exams/${exam.id}/attempts/${attemptId}/${kind}`, {
        method: 'POST',
        body: { minutes: Math.round(minutes), reason },
      });
      await load();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  async function release(attemptId: string, name: string) {
    if (
      !(await confirmDialog(
        `Let ${name} continue this exam on a different device? The device they are using now will be locked out.`,
        { title: 'Switch device', confirmLabel: 'Allow' },
      ))
    )
      return;
    try {
      await api(`/exams/${exam.id}/attempts/${attemptId}/release-device`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  async function exportCsv() {
    try {
      const blob = await apiBlob(`/exams/${exam.id}/results.csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exam.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-results.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  if (!data) return error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>;
  const { stats } = data;

  return (
    <div className="stack">
      <div className="stats">
        <StatCard
          label="Attempts"
          value={stats.attempts}
          note={`of ${data.exam.enrolled} who joined`}
          icon="users"
          highlight
        />
        <StatCard
          label="Submitted"
          value={stats.submitted}
          note={`${stats.inProgress} still taking`}
          icon="check"
        />
        <StatCard
          label="Average score"
          value={stats.average === null ? 'N/A' : `${stats.average} / ${data.exam.totalMarks}`}
          note={stats.highest === null ? 'no marked attempts yet' : `highest ${stats.highest}`}
          icon="zap"
        />
        <StatCard
          label="Pass rate"
          value={stats.passRate === null ? 'N/A' : `${stats.passRate}%`}
          note={`pass mark ${data.exam.passPercent}%`}
          icon="shield"
        />
      </div>

      {error && <Alert>{error}</Alert>}
      {data.finalized ? (
        <Alert kind="success">
          Results are published. Each student was emailed their score, certificate and answer sheet.
        </Alert>
      ) : stats.pendingGrading > 0 ? (
        <Alert kind="info">
          {stats.pendingGrading} written answer{stats.pendingGrading === 1 ? '' : 's'} still need
          marks. As you finish marking a student, they are emailed their score, certificate and
          answer sheet automatically (about {RESULT_RELEASE_DELAY_MIN} minutes after the exam
          closes). After that, that student&apos;s marks are locked.
        </Alert>
      ) : (
        <Alert kind="info">
          After the exam closes, each student is emailed one message with their score, certificate
          and answer sheet automatically, about {RESULT_RELEASE_DELAY_MIN} minutes later. Fix answer
          keys or drop questions before then. &quot;Publish results&quot; sends it right away.
        </Alert>
      )}

      <div className="toolbar">
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
        <Button variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
        <span className="spacer" />
        {!data.finalized && (
          <Button loading={busy} onClick={publish}>
            Publish results
          </Button>
        )}
      </div>

      {data.rows.length === 0 ? (
        <div className="empty">
          <strong>No attempts yet</strong>
          Attempts appear here as students start the exam.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Score</th>
                <th>Result</th>
                <th>Strikes</th>
                <th>Events</th>
                <th>Integrity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.attemptId}>
                  <td>
                    <strong>{r.studentName}</strong>
                    <div className="muted">{r.studentEmail}</div>
                  </td>
                  <td>{rowStatus(r)}</td>
                  <td>{when(r.submittedAt)}</td>
                  <td>
                    {r.score === null
                      ? 'N/A'
                      : `${r.score} / ${r.maxScore ?? data.exam.totalMarks}`}
                    {r.percent !== null && <div className="muted">{r.percent}%</div>}
                  </td>
                  <td>
                    {r.passed === null ? (
                      'N/A'
                    ) : (
                      <StatusBadge
                        status={r.passed ? 'LIVE' : 'SUSPENDED'}
                        label={r.passed ? 'Pass' : 'Fail'}
                      />
                    )}
                  </td>
                  <td>{r.strikes}</td>
                  <td>{r.violations}</td>
                  <td>
                    <FlagBadges flags={r.flags} />
                  </td>
                  <td>
                    {r.status === 'IN_PROGRESS' && (
                      <>
                        <Button
                          variant="secondary"
                          small
                          onClick={() => void release(r.attemptId, r.studentName)}
                        >
                          Release device
                        </Button>{' '}
                        <Button
                          variant="secondary"
                          small
                          onClick={() => void adjust(r.attemptId, r.studentName, 'add-time')}
                        >
                          Add time
                        </Button>
                      </>
                    )}
                    {r.status !== 'IN_PROGRESS' && !data.finalized && (
                      <>
                        <Button
                          variant="secondary"
                          small
                          onClick={() => void adjust(r.attemptId, r.studentName, 'reopen')}
                        >
                          Reopen
                        </Button>{' '}
                      </>
                    )}
                    {r.status !== 'IN_PROGRESS' && (
                      <Link
                        className="btn btn-secondary btn-small btn-link"
                        href={`/exams/grade/?exam=${exam.id}&attempt=${r.attemptId}`}
                      >
                        {r.pendingGrading > 0 && !data.finalized ? 'Mark' : 'View'}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
