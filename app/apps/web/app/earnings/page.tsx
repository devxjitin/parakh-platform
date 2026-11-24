'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EarningsDto, PayoutDetailsDto, PayoutDto } from '@parakh/shared';
import { PayoutDetailsForm } from '../../components/payout-details-form';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  Shell,
  StatCard,
  StatusBadge,
  describeError,
} from '../../components/ui';
import { api, apiBlob } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'N/A');

export default function EarningsPage() {
  const { user, loading } = useRequireAuth();
  const [data, setData] = useState<EarningsDto | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<EarningsDto>('/me/earnings'));
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'EXAMINER') void load();
  }, [user, load]);

  async function request() {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api<PayoutDto>('/me/payouts/request', { method: 'POST' });
      setNote('Payout requested. NandiVex Technologies will pay it and email you the reference.');
      await load();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function statement(p: PayoutDto) {
    try {
      const blob = await apiBlob(`/payouts/${p.id}/statement.csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payout-${p.id.slice(0, 8)}-statement.csv`;
      a.click();
      URL.revokeObjectURL(url);
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
  if (user.role !== 'EXAMINER') {
    return (
      <Shell wide>
        <Alert>This page is for trainers.</Alert>
      </Shell>
    );
  }

  const b = data?.balances;
  const hasOpen = Boolean(data?.payouts.some((p) => p.status === 'REQUESTED'));
  const canRequest =
    !!data?.details.method &&
    !!b &&
    b.payablePaise > 0 &&
    b.payablePaise >= b.minPayoutPaise &&
    !hasOpen;
  let why = '';
  if (data && !canRequest) {
    if (!data.details.method) why = 'Add your payout details first.';
    else if (hasOpen) why = 'You already have a payout request waiting.';
    else if (b && b.payablePaise < Math.max(b.minPayoutPaise, 1))
      why = `You can ask for a payout once at least ${rupees(Math.max(b.minPayoutPaise, 100))} is payable.`;
  }

  return (
    <Shell wide>
      <PageHeader
        title="Earnings"
        subtitle="Your 50% share of each student's exam fee. Money becomes payable when you publish an exam's results."
      />
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}

      {b && (
        <div className="stats">
          <StatCard
            label="Payable now"
            value={rupees(b.payablePaise)}
            note="results published, not yet requested"
            icon="zap"
            highlight
          />
          <StatCard
            label="Waiting for results"
            value={rupees(b.accruedPaise)}
            note="becomes payable when results are published"
            icon="clock"
          />
          <StatCard
            label="Requested"
            value={rupees(b.pendingPaise)}
            note="waiting for NandiVex Technologies to pay"
            icon="check"
          />
          <StatCard label="Paid to you" value={rupees(b.paidPaise)} icon="shield" />
        </div>
      )}
      {b && b.owedBackPaise > 0 && (
        <Alert kind="info">
          {rupees(b.owedBackPaise)} from refunds after an earlier payout will be deducted from your
          next payouts.
        </Alert>
      )}
      <p className="muted">
        Sponsored seats you buy for students are not earnings and do not appear here.
      </p>

      {data && (
        <div className="stack">
          <Card title="Payout details" subtitle="Where NandiVex Technologies sends your money.">
            <PayoutDetailsForm
              details={data.details}
              onSaved={(d: PayoutDetailsDto) => setData({ ...data, details: d })}
            />
            <div style={{ marginTop: 16 }}>
              <Button loading={busy} disabled={!canRequest} onClick={request}>
                Request payout of {rupees(b?.payablePaise ?? 0)}
              </Button>
              {why && (
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {why}
                </p>
              )}
            </div>
          </Card>

          <Card title="By exam">
            {data.exams.length === 0 ? (
              <p className="muted">No paid students yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Exam</th>
                      <th>Students paid</th>
                      <th>Collected</th>
                      <th>Your share</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exams.map((e) => (
                      <tr key={e.examId}>
                        <td>{e.title}</td>
                        <td>{e.joins}</td>
                        <td>{rupees(e.grossPaise)}</td>
                        <td>{rupees(e.sharePaise)}</td>
                        <td>
                          <StatusBadge
                            status={e.state === 'PAYABLE' ? 'RESULTS_FINAL' : 'PAYMENT_PENDING'}
                            label={e.state === 'PAYABLE' ? 'Payable' : 'Waiting for results'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Payout history">
            {data.payouts.length === 0 ? (
              <p className="muted">No payouts yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Requested</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Paid on</th>
                      <th>Reference</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((p) => (
                      <tr key={p.id}>
                        <td>{day(p.requestedAt)}</td>
                        <td>{rupees(p.amountPaise)}</td>
                        <td>
                          <StatusBadge
                            status={
                              p.status === 'PAID'
                                ? 'RESULTS_FINAL'
                                : p.status === 'REJECTED'
                                  ? 'CANCELLED'
                                  : 'PAYMENT_PENDING'
                            }
                            label={p.status.toLowerCase()}
                          />
                          {p.status === 'REJECTED' && p.note && (
                            <div className="muted">{p.note}</div>
                          )}
                        </td>
                        <td>{day(p.paidAt)}</td>
                        <td>{p.utr ?? 'N/A'}</td>
                        <td>
                          {p.status === 'PAID' && (
                            <Button variant="secondary" small onClick={() => statement(p)}>
                              Statement
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
