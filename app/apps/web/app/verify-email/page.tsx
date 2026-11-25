'use client';

import { COPY } from '../../lib/copy';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuthResponse } from '@parakh/shared';
import { verifyEmailSchema } from '@parakh/shared';
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
import { useAuth } from '../../lib/auth';

export default function VerifyEmailPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const email = useQueryParam('email');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = validate(verifyEmailSchema, {
      email,
      code: String(form.get('code') ?? '').trim(),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      const session = await api<AuthResponse>('/auth/verify-email', {
        method: 'POST',
        body: result.data,
        auth: false,
      });
      setSession(session);
      router.replace('/dashboard/');
    } catch (err) {
      setFormError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setFormError('');
    setInfo('');
    try {
      await api('/auth/resend-code', {
        method: 'POST',
        body: { email, purpose: 'VERIFY_EMAIL' },
        auth: false,
      });
      setInfo(
        'If the address is right, a new code is on its way. Codes can be re-sent once a minute.',
      );
    } catch (err) {
      setFormError(describeError(err).message);
    }
  }

  return (
    <Shell>
      <Card
        title="Check your email"
        subtitle={
          email ? `We sent a 6-digit code to ${email}.` : 'Enter the 6-digit code we emailed you.'
        }
      >
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="Verification code"
            required
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="code-input"
            error={errors.code}
          />
          {formError && <Alert>{formError}</Alert>}
          {info && <Alert kind="info">{info}</Alert>}
          <Button type="submit" loading={busy}>
            {COPY.verifyCode}
          </Button>
        </form>
        <p className="links">
          <button type="button" className="btn btn-secondary" onClick={resend} disabled={!email}>
            {COPY.resendCode}
          </button>
        </p>
      </Card>
    </Shell>
  );
}
