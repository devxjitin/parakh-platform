'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { forgotPasswordSchema } from '@parakh/shared';
import {
  Alert,
  Button,
  Card,
  Field,
  FieldErrors,
  Shell,
  describeError,
  validate,
} from '../../components/ui';
import { api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = validate(forgotPasswordSchema, { email: form.get('email') });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: result.data, auth: false });
      router.push(`/reset-password/?email=${encodeURIComponent(result.data.email)}`);
    } catch (err) {
      setFormError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card
        title="Reset your password"
        subtitle="Enter your email and we will send you a 6-digit code."
      >
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="Email"
            required
            name="email"
            type="email"
            autoComplete="email"
            error={errors.email}
          />
          {formError && <Alert>{formError}</Alert>}
          <Button type="submit" loading={busy}>
            Send code
          </Button>
        </form>
        <p className="links">
          <Link href="/login/">Back to sign in</Link>
        </p>
      </Card>
    </Shell>
  );
}
