'use client';

import Link from 'next/link';
import { useState } from 'react';
import { deleteAccountSchema } from '@parakh/shared';
import { api, apiBlob } from '../lib/api';
import { Alert, Button, Card, Field, describeError } from './ui';
import { confirmDialog } from './dialogs';

/** Data rights: download everything we hold, or close the account and wipe who you are. */
export function MyDataPanel({ canClose, onClosed }: { canClose: boolean; onClosed: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [closing, setClosing] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  async function download() {
    setBusy('download');
    setError('');
    try {
      const blob = await apiBlob('/users/me/data');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'parakh-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  async function close(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = deleteAccountSchema.safeParse({
      password: new FormData(e.currentTarget).get('password'),
    });
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? 'Enter your password');
      return;
    }
    setPasswordError('');
    if (
      !(await confirmDialog(
        'Close your account for good? Your name, email and phone are removed and you cannot sign in again. This cannot be undone.',
        { title: 'Close your account', confirmLabel: 'Close account', danger: true },
      ))
    ) {
      return;
    }
    setBusy('close');
    setError('');
    try {
      await api('/users/me/delete', { method: 'POST', body: parsed.data });
      onClosed();
    } catch (err) {
      setError(describeError(err).message);
      setBusy('');
    }
  }

  return (
    <Card title="Your data" subtitle="Download what we hold about you, or close your account.">
      {error && <Alert>{error}</Alert>}
      <div className="stack">
        <div>
          <Button variant="secondary" loading={busy === 'download'} onClick={download}>
            Download my data
          </Button>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            A JSON file with your account, exams, answers, payments and certificates. Passwords and
            sign-in tokens are never included.
          </p>
        </div>
        {canClose && (
          <div>
            {!closing ? (
              <Button variant="danger" onClick={() => setClosing(true)}>
                Close my account
              </Button>
            ) : (
              <form onSubmit={close} noValidate>
                <Alert kind="info">
                  Your name, email, phone and sign-in are removed. Payment records and issued
                  certificates are kept, as the <Link href="/privacy/">privacy policy</Link>{' '}
                  explains. Trainers must first close or cancel open exams and be paid out.
                </Alert>
                <Field
                  label="Confirm with your password"
                  required
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  error={passwordError}
                />
                <div className="toolbar">
                  <Button type="submit" variant="danger" loading={busy === 'close'}>
                    Close my account for good
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setClosing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
