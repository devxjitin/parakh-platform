'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminPaymentRow } from '@parakh/shared';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatusBadge,
  describeError,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { promptDialog } from '../../../components/dialogs';
import { SearchField } from '../../../components/search-field';

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const PURPOSE: Record<AdminPaymentRow['purpose'], string> = {
  EXAM_CREATION: 'Publishing fee',
  EXAM_JOIN: 'Student join fee',
};
const STATUS_KIND: Record<AdminPaymentRow['status'], string> = {
  CREATED: 'PAYMENT_PENDING',
  CAPTURED: 'LIVE',
  FAILED: 'SUSPENDED',
  PENDING_REFUND: 'GRADING',
  REFUNDED: 'GRADING',
};

export default function AdminPaymentsPage() {
  const { user, loading } = useRequireAuth();
  const [rows, setRows] = useState<AdminPaymentRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (purpose) params.set('purpose', purpose);
    if (q.trim()) params.set('q', q.trim());
    try {
      setRows(await api<AdminPaymentRow[]>(`/admin/finance/payments?${params}`));
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [status, purpose, q]);

  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [user, load]);

  async function refund(p: AdminPaymentRow) {
    const reason = await promptDialog(
      `Refund ${rupees(p.amountPaise)} to ${p.userEmail}? The money goes back to their card or account, ` +
        `the trainer's share is taken back and the seat is cancelled.`,
      {
        title: 'Refund this payment',
        label: 'Reason (the customer is emailed this)',
        minLength: 3,
        confirmLabel: 'Refund',
        danger: true,
      },
    );
    if (!reason) return;
    setBusy(p.id);
    setError('');
    setNote('');
    try {
      await api(`/admin/finance/payments/${p.id}/refund`, { method: 'POST', body: { reason } });
      setNote(`Refunded ${rupees(p.amountPaise)} to ${p.userEmail}.`);
      await load();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

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
      <PageHeader title="Payments" subtitle="Find a payment and refund it." />
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {rows && rows.some((p) => p.needsRefund && p.status === 'CAPTURED') && (
        <Alert>
          Needs a refund (paid, nothing delivered):{' '}
          {rows
            .filter((p) => p.needsRefund && p.status === 'CAPTURED')
            .map((p) => `${p.receiptNo} ${rupees(p.amountPaise)} ${p.userEmail}`)
            .join(', ')}
        </Alert>
      )}
      <section className="card">
        <div className="toolbar admin-filters">
          <SearchField placeholder="Search name, email or exam" value={q} onChange={setQ} />
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="">All types</option>
            <option value="EXAM_JOIN">Student join fee</option>
            <option value="EXAM_CREATION">Publishing fee</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="CAPTURED">Paid</option>
            <option value="PENDING_REFUND">Refund in progress</option>
            <option value="REFUNDED">Refunded</option>
            <option value="CREATED">Unpaid</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No payments match.</p>
        ) : (
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>For</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.receiptNo}
                      <div className="muted">
                        {new Date(p.capturedAt ?? Date.now()).toLocaleDateString()}
                      </div>
                    </td>
                    <td>
                      {p.userName}
                      <div className="muted">{p.userEmail}</div>
                    </td>
                    <td>
                      {PURPOSE[p.purpose]}
                      <div className="muted">{p.examTitle ?? ''}</div>
                    </td>
                    <td className="num">{rupees(p.amountPaise)}</td>
                    <td>
                      <StatusBadge
                        status={STATUS_KIND[p.status]}
                        label={
                          p.status === 'CAPTURED'
                            ? 'paid'
                            : p.status === 'PENDING_REFUND'
                              ? 'refund in progress'
                              : p.status.toLowerCase()
                        }
                      />
                      {p.needsRefund && p.status === 'CAPTURED' && (
                        <div className="muted" style={{ color: 'var(--danger, #b00020)' }}>
                          needs refund
                        </div>
                      )}
                      {p.refundReason && <div className="muted">{p.refundReason}</div>}
                    </td>
                    <td>
                      {p.status === 'CAPTURED' && p.purpose !== 'EXAM_CREATION' && (
                        <Button
                          variant="danger"
                          small
                          loading={busy === p.id}
                          onClick={() => refund(p)}
                        >
                          Refund
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
