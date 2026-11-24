'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminRefundRequestRow } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, Card, describeError } from './ui';
import { confirmDialog, promptDialog } from './dialogs';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Admin: students asking for their exam fee back. Approving is the normal refund. */
export function RefundRequestsPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<AdminRefundRequestRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(
        await api<AdminRefundRequestRow[]>('/admin/finance/refund-requests?status=REQUESTED'),
      );
      setError('');
    } catch (err) {
      setError(describeError(err).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(r: AdminRefundRequestRow, kind: 'approve' | 'reject') {
    let body: { note: string } | undefined;
    if (kind === 'reject') {
      const note = await promptDialog('The student will see this note.', {
        title: 'Why is this refund not approved?',
        label: 'Note',
        confirmLabel: 'Reject refund',
        danger: true,
      });
      if (!note) return;
      body = { note };
    } else if (
      !(await confirmDialog(
        `Refund ${rupees(r.amountPaise)} to ${r.studentName}? The money goes back through the payment gateway and their seat is cancelled.`,
        { title: 'Approve refund', confirmLabel: 'Refund', danger: true },
      ))
    ) {
      return;
    }
    setBusy(r.id);
    setError('');
    try {
      await api(`/admin/finance/refund-requests/${r.id}/${kind}`, { method: 'POST', body });
      await load();
      onChanged?.();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  if (rows === null || rows.length === 0) {
    return error ? <Alert>{error}</Alert> : null;
  }
  return (
    <Card
      title={`Refund requests (${rows.length})`}
      subtitle="Students asking for their fee back before starting."
    >
      {error && <Alert>{error}</Alert>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Exam</th>
              <th>Amount</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.studentName}
                  <div className="muted">{r.studentEmail}</div>
                </td>
                <td>
                  {r.examTitle ?? 'N/A'}
                  <div className="muted">{r.receiptNo}</div>
                </td>
                <td>{rupees(r.amountPaise)}</td>
                <td>{r.reason}</td>
                <td>
                  {r.stillEligible ? (
                    <div className="toolbar">
                      <Button
                        small
                        loading={busy === r.id}
                        onClick={() => void decide(r, 'approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        small
                        disabled={busy === r.id}
                        onClick={() => void decide(r, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <div className="stack">
                      <span className="muted">The student has started the exam.</span>
                      <Button
                        variant="secondary"
                        small
                        disabled={busy === r.id}
                        onClick={() => void decide(r, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
