'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CERT_KIND_TITLE,
  type CertQueueExamDto,
  type CertQueueRowDto,
  type CertStatus,
} from '@parakh/shared';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatusBadge,
  describeError,
} from '../../../components/ui';
import { api, apiBlob } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { confirmDialog, promptDialog } from '../../../components/dialogs';

const VIEWS: { key: CertStatus; label: string }[] = [
  { key: 'GENERATED', label: 'Waiting' },
  { key: 'EMAILED', label: 'Emailed' },
  { key: 'APPROVED', label: 'Sending' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function AdminCertificatesPage() {
  const { user, loading } = useRequireAuth();
  const [view, setView] = useState<CertStatus>('EMAILED');
  const [examId, setExamId] = useState('');
  const [exams, setExams] = useState<CertQueueExamDto[]>([]);
  const [rows, setRows] = useState<CertQueueRowDto[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ status: view });
      if (examId) q.set('examId', examId);
      const data = await api<{ exams: CertQueueExamDto[]; rows: CertQueueRowDto[] }>(
        `/admin/certificates?${q}`,
      );
      setExams(data.exams);
      setRows(data.rows);
      setPicked(new Set());
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [view, examId]);

  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [user, load]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError('');
    setNote('');
    try {
      setNote(await fn());
      await load();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  const approveExam = async (e: CertQueueExamDto) => {
    const ok = await confirmDialog(
      `Approve all ${e.waiting} waiting certificates for "${e.examTitle}"? They will be emailed to the students.`,
      { title: 'Approve certificates', confirmLabel: 'Approve all' },
    );
    if (!ok) return;
    await run('exam' + e.examId, async () => {
      const r = await api<{ approved: number }>('/admin/certificates/approve', {
        method: 'POST',
        body: { examId: e.examId },
      });
      return `${r.approved} certificates approved. They are being emailed.`;
    });
  };

  const approvePicked = () =>
    run('picked', async () => {
      const r = await api<{ approved: number }>('/admin/certificates/approve', {
        method: 'POST',
        body: { ids: [...picked] },
      });
      return `${r.approved} certificates approved.`;
    });

  async function rejectPicked() {
    const reason = await promptDialog(
      `Reject ${picked.size} certificate(s)? Students are not emailed.`,
      {
        title: 'Reject certificates',
        label: 'Reason (kept in the audit log)',
        confirmLabel: 'Reject',
        danger: true,
      },
    );
    if (!reason) return;
    void run('reject', async () => {
      const r = await api<{ rejected: number }>('/admin/certificates/reject', {
        method: 'POST',
        body: { ids: [...picked], reason },
      });
      return `${r.rejected} certificates rejected.`;
    });
  }

  async function preview(row: CertQueueRowDto) {
    try {
      const blob = await apiBlob(`/admin/certificates/${row.id}/pdf`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  const regenerate = (row: CertQueueRowDto) =>
    run('regen' + row.id, async () => {
      await api(`/admin/certificates/${row.id}/regenerate`, { method: 'POST' });
      return `Making the PDF for ${row.serialNo} again.`;
    });

  const resend = (row: CertQueueRowDto) =>
    run('resend' + row.id, async () => {
      await api(`/admin/certificates/${row.id}/resend`, { method: 'POST' });
      return `Queued to send again to ${row.holderEmail}.`;
    });

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
        <Alert>This page is for NandiVex Technologies staff.</Alert>
      </Shell>
    );
  }

  const waitingTotal = exams.reduce((s, e) => s + e.waiting, 0);

  return (
    <Shell wide>
      <PageHeader
        title="Certificates"
        subtitle="Certificates are emailed automatically when a trainer publishes results. Reject one here if it must be revoked."
      />
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Exams ({waitingTotal} waiting)</h2>
        {exams.length === 0 ? (
          <p className="muted">
            Certificates appear here after a trainer publishes an exam&apos;s results.
          </p>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Trainer</th>
                  <th>Waiting</th>
                  <th>Issued</th>
                  <th>Rejected</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.examId}>
                    <td>{e.examTitle}</td>
                    <td>{e.trainerName}</td>
                    <td>{e.waiting}</td>
                    <td>{e.approved}</td>
                    <td>{e.rejected}</td>
                    <td>
                      <div className="toolbar">
                        <Button
                          variant="secondary"
                          small
                          onClick={() => setExamId(examId === e.examId ? '' : e.examId)}
                        >
                          {examId === e.examId ? 'Show all exams' : 'Review'}
                        </Button>
                        {e.waiting > 0 && (
                          <Button
                            small
                            loading={busy === 'exam' + e.examId}
                            onClick={() => approveExam(e)}
                          >
                            Approve all {e.waiting}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              className="tab"
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        {(view === 'GENERATED' || view === 'REJECTED') && picked.size > 0 && (
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <strong>{picked.size} selected</strong>
            <Button small loading={busy === 'picked'} onClick={approvePicked}>
              Approve selected
            </Button>
            {view === 'GENERATED' && (
              <Button variant="danger" small onClick={rejectPicked}>
                Reject selected
              </Button>
            )}
          </div>
        )}
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Nothing here.</p>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Certificate</th>
                  <th>Score</th>
                  <th>Serial</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {(view === 'GENERATED' || view === 'REJECTED') && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.holderName}`}
                          checked={picked.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      )}
                    </td>
                    <td>
                      <strong>{r.holderName}</strong>
                      <div className="muted">{r.holderEmail}</div>
                    </td>
                    <td>{r.examTitle}</td>
                    <td>
                      {CERT_KIND_TITLE[r.kind]}
                      {r.emailBounced && (
                        <div>
                          <StatusBadge status="SUSPENDED" label="email bounced" />
                        </div>
                      )}
                      {r.emailError && !r.emailBounced && r.status === 'APPROVED' && (
                        <div className="muted">will retry: {r.emailError}</div>
                      )}
                      {r.rejectReason && <div className="muted">{r.rejectReason}</div>}
                    </td>
                    <td>
                      {r.kind === 'TRAINER'
                        ? `${r.participants ?? 0} students`
                        : `${r.scorePercent}%`}
                    </td>
                    <td className="mono">{r.serialNo}</td>
                    <td>
                      <div className="toolbar">
                        <Button variant="secondary" small onClick={() => preview(r)}>
                          Preview
                        </Button>
                        {r.pdfError && (
                          <Button
                            variant="danger"
                            small
                            loading={busy === 'regen' + r.id}
                            onClick={() => regenerate(r)}
                          >
                            PDF failed: regenerate
                          </Button>
                        )}
                        {(r.status === 'EMAILED' || r.status === 'APPROVED') && (
                          <Button
                            variant="secondary"
                            small
                            loading={busy === 'resend' + r.id}
                            onClick={() => resend(r)}
                          >
                            Resend
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  );
}
