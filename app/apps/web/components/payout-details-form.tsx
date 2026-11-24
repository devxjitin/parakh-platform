'use client';

import { useState } from 'react';
import { payoutDetailsSchema, type PayoutDetailsDto } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, Req, describeError } from './ui';

/** Where NandiVex sends the trainer's share. Changing it means NandiVex must verify it again. */
export function PayoutDetailsForm({
  details,
  onSaved,
}: {
  details: PayoutDetailsDto;
  onSaved: (d: PayoutDetailsDto) => void;
}) {
  const [editing, setEditing] = useState(!details.method);
  const [method, setMethod] = useState<'UPI' | 'BANK'>(details.method ?? 'UPI');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = payoutDetailsSchema.safeParse(
      method === 'UPI'
        ? { method, upiId: f.get('upiId') }
        : {
            method,
            accountName: f.get('accountName'),
            accountNumber: f.get('accountNumber'),
            ifsc: f.get('ifsc'),
          },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the details and try again');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSaved(
        await api<PayoutDetailsDto>('/me/payout-details', { method: 'PUT', body: parsed.data }),
      );
      setEditing(false);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing && details.method) {
    return (
      <div className="stack">
        <p style={{ margin: 0 }}>
          <strong>{details.method === 'UPI' ? 'UPI' : 'Bank transfer'}:</strong>{' '}
          {details.method === 'UPI'
            ? details.upiId
            : `${details.accountName}, ${details.ifsc}, ${details.accountMasked}`}{' '}
          <span className={`badge ${details.verifiedAt ? 'badge-success' : ''}`}>
            {details.verifiedAt ? 'verified' : 'waiting for NandiVex Technologies to verify'}
          </span>
        </p>
        <div>
          <Button variant="secondary" small onClick={() => setEditing(true)}>
            Change details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      <div className="role-choice" role="radiogroup" aria-label="Payout method">
        <label>
          <input type="radio" checked={method === 'UPI'} onChange={() => setMethod('UPI')} />
          <strong>UPI</strong>
          <small>Fastest. Needs a UPI id.</small>
        </label>
        <label>
          <input type="radio" checked={method === 'BANK'} onChange={() => setMethod('BANK')} />
          <strong>Bank account</strong>
          <small>Account number and IFSC.</small>
        </label>
      </div>
      {method === 'UPI' ? (
        <label className="field">
          <span>
            UPI id
            <Req />
          </span>
          <input name="upiId" placeholder="name@bank" autoComplete="off" />
        </label>
      ) : (
        <>
          <label className="field">
            <span>
              Name on the account
              <Req />
            </span>
            <input name="accountName" autoComplete="off" />
          </label>
          <label className="field">
            <span>
              Account number
              <Req />
            </span>
            <input name="accountNumber" inputMode="numeric" autoComplete="off" />
            <small className="muted">
              Stored encrypted. Only the last 4 digits are shown later.
            </small>
          </label>
          <label className="field">
            <span>
              IFSC code
              <Req />
            </span>
            <input name="ifsc" placeholder="HDFC0001234" autoComplete="off" />
          </label>
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="toolbar">
        <Button type="submit" loading={busy}>
          Save payout details
        </Button>
        {details.method && (
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
