'use client';

import Link from 'next/link';
import { useState } from 'react';
import { resetPasswordSchema } from '@parakh/shared';
import {
  Alert,
  Button,
  Card,
  Field,
  FieldErrors,
  Shell,
  describeError,
  useQueryParam,
  validate,
} from '../../components/ui';
import { api } from '../../lib/api';

export default function ResetPasswordPage() {
  const email = useQueryParam('email');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = validate(resetPasswordSchema, {
      email,
      code: String(form.get('code') ?? '').trim(),
      newPassword: form.get('newPassword'),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: result.data, auth: false });
      setDone(true);
    } catch (err) {
      const d = describeError(err);
      setFormError(d.message);
      setErrors(d.fields);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <Card title="Password updated">
          <Alert kind="success">
            Your password was changed and other sessions were signed out.
          </Alert>
          <p className="links">
            <Link href="/login/">Sign in</Link>
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card
        title="Choose a new password"
        subtitle={
          email ? `Enter the code we emailed to ${email}.` : 'Enter the code we emailed you.'
        }
      >
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="Code"
            required
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="code-input"
            error={errors.code}
          />
          <Field
            label="New password"
            required
            name="newPassword"
            type="password"
            autoComplete="new-password"
            hint="At least 10 characters, with a letter and a number."
            error={errors.newPassword}
          />
          {formError && <Alert>{formError}</Alert>}
          <Button type="submit" loading={busy}>
            Update password
          </Button>
        </form>
        <p className="links">
          <Link href="/forgot-password/">Resend code</Link>
        </p>
      </Card>
    </Shell>
  );
}
