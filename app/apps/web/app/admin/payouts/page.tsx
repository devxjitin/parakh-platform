'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminPayableRow, LedgerCheckDto, PayoutDto } from '@parakh/shared';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatCard,
  StatusBadge,
  describeError,
  Req,
} from '../../../components/ui';
import { api, apiBlob } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { promptDialog } from '../../../components/dialogs';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'N/A');

type HistoryRow = PayoutDto & { examinerName: string; examinerEmail: string };

function PayRow({ row, onDone }: { row: AdminPayableRow; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [amount, setAmount] = useState(
    (row.request?.amountPaise ?? row.balances.payablePaise) / 100,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const meets = row.balances.payablePaise >= row.balances.minPayoutPaise;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setOpen(false);
      await onDone();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const pay = () =>
    run(() =>
      row.request
        ? api(`/admin/finance/payouts/${row.request.id}/pay`, { method: 'POST', body: { utr } })
        : api('/admin/finance/payouts', {
            method: 'POST',
            body: { examinerId: row.examinerId, amountPaise: Math.round(amount * 100), utr },
          }),
    );
  const reject = async () => {
    const note = await promptDialog('The trainer will see this note.', {
      title: 'Why is this payout not being paid?',
      label: 'Note',
      confirmLabel: 'Reject payout',
      danger: true,
    });
    if (!note || !row.request) return;
    void run(() =>
      api(`/admin/finance/payouts/${row.request!.id}/reject`, { method: 'POST', body: { note } }),
    );
  };
  const verify = () =>
    run(() => api(`/admin/finance/examiners/${row.examinerId}/verify-details`, { method: 'POST' }));

  return (
    <>
      <tr>
        <td>
          <strong>{row.name}</strong>
          <div className="muted">{row.email}</div>
        </td>
        <td>
          {rupees(row.balances.payablePaise + row.balances.pendingPaise)}
          {row.request ? (
            <div>
              <StatusBadge status="PAYMENT_PENDING" label="Requested" />
            </div>
          ) : (
            !meets && <div className="muted">below minimum</div>
          )}
          {row.balances.owedBackPaise > 0 && (
            <div className="muted">owes back {rupees(row.balances.owedBackPaise)}</div>
          )}
        </td>
        <td>{rupees(row.balances.accruedPaise)}</td>
        <td style={{ maxWidth: 280, wordBreak: 'break-word' }}>
          {row.destination ?? <span className="muted">No details yet</span>}
          {row.method && (
            <div>
              {row.detailsVerified ? (
                <StatusBadge status="LIVE" label="Verified" />
              ) : (
                <Button variant="secondary" small loading={busy} onClick={verify}>
                  Mark details verified
                </Button>
              )}
            </div>
          )}
        </td>
        <td>
          {!open && (row.request || meets) && row.method && (
            <div className="toolbar">
              <Button
                small
                disabled={!row.detailsVerified}
                title={row.detailsVerified ? undefined : 'Mark the payout details as checked first'}
                onClick={() => setOpen(true)}
              >
                {row.request ? 'Mark paid' : 'Pay now'}
              </Button>
              {row.request && (
                <Button variant="secondary" small onClick={reject}>
                  Reject
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <div className="toolbar" style={{ alignItems: 'flex-end' }}>
              <label className="field" style={{ margin: 0 }}>
                <span>
                  Amount (₹)
                  <Req />
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  disabled={Boolean(row.request)}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
              <label className="field" style={{ margin: 0, minWidth: 260 }}>
                <span>
                  UTR / reference from your bank or UPI app
                  <Req />
                </span>
                <input
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  placeholder="e.g. 4012345678"
                />
              </label>
              <Button loading={busy} disabled={utr.trim().length < 6} onClick={pay}>
                Mark as paid {rupees(Math.round(amount * 100))}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Send the money first (UPI or bank), then enter the reference here. This books the
              payout in the ledger and emails the trainer.
            </p>
          </td>
        </tr>
      )}
      {error && (
        <tr>
          <td colSpan={5}>
            <Alert>{error}</Alert>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminPayoutsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<AdminPayableRow[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [ledger, setLedger] = useState<LedgerCheckDto | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, h, l] = await Promise.all([
        api<AdminPayableRow[]>('/admin/finance/payable'),
        api<HistoryRow[]>('/admin/finance/payouts'),
        api<LedgerCheckDto>('/admin/finance/ledger'),
      ]);
      setRows(p);
      setHistory(h.filter((x) => x.status !== 'REQUESTED'));
      setLedger(l);
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [user, load]);

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

  const ledgerOk = Boolean(
    ledger && ledger.totalPaise === 0 && ledger.unbalancedTransactions.length === 0,
  );

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

  return (
    <Shell wide>
      <PageHeader
        title="Payouts"
        subtitle="Pay each trainer their 50% by UPI or bank transfer, then record the reference here."
      >
        {ledger && ledgerOk && (
          <span
            className="health-chip"
            title={`Ledger check passed: ${ledger.transactions} transactions, ${ledger.entries} entries, all balance to the paisa.`}
          >
            <span className="health-dot" aria-hidden />
            Ledger balanced
          </span>
        )}
      </PageHeader>
      {error && <Alert>{error}</Alert>}

      {ledger && (
        <div className="stats">
          <StatCard
            label="Collected"
            value={rupees(ledger.grossCollectedPaise)}
            note="all payments, net of refunds"
            icon="zap"
            highlight
          />
          <StatCard
            label="NandiVex Technologies revenue"
            value={rupees(ledger.platformPaise)}
            note="platform account"
            icon="check"
          />
          <StatCard
            label="Owed to trainers"
            value={rupees(ledger.owedToTrainersPaise)}
            note="accruing and payable"
            icon="clock"
          />
          <StatCard
            label="Paid out"
            value={rupees(ledger.paidOutPaise)}
            note="all time"
            icon="shield"
          />
        </div>
      )}
      {ledger && !ledgerOk && (
        <Alert kind="error">
          {`Ledger check FAILED: off by ${ledger.totalPaise} paise, ${ledger.unbalancedTransactions.length} unbalanced transactions. Stop payouts until this is checked.`}
        </Alert>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>To pay</h2>
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Nobody is owed money right now.</p>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Trainer</th>
                  <th>Payable</th>
                  <th>Accruing</th>
                  <th>Send to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <PayRow key={r.examinerId} row={r} onDone={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>History</h2>
        {history.length === 0 ? (
          <p className="muted">No payouts yet.</p>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Trainer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td>{day(p.paidAt ?? p.requestedAt)}</td>
                    <td>
                      {p.examinerName}
                      <div className="muted">{p.examinerEmail}</div>
                    </td>
                    <td>{rupees(p.amountPaise)}</td>
                    <td>
                      <StatusBadge
                        status={p.status === 'PAID' ? 'RESULTS_FINAL' : 'SUSPENDED'}
                        label={p.status === 'PAID' ? 'Paid' : 'Rejected'}
                      />
                      {p.status === 'REJECTED' && p.note && <div className="muted">{p.note}</div>}
                    </td>
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
      </section>
    </Shell>
  );
}
