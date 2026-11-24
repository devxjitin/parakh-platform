'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuthResponse } from '@parakh/shared';
import { loginSchema } from '@parakh/shared';
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
import { ApiError, api } from '../../lib/api';
import { useRedirectIfSignedIn } from '../../lib/auth';
import { useAuth } from '../../lib/auth';
import { AudienceSwitch } from '../../components/audience-switch';

export default function LoginPage() {
  useRedirectIfSignedIn(true);
  const router = useRouter();
  const { setSession } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = validate(loginSchema, {
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      const session = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: result.data,
        auth: false,
      });
      setSession(session);
      router.replace('/dashboard/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        router.push(`/verify-email/?email=${encodeURIComponent(result.data.email)}`);
        return;
      }
      setFormError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell auth>
      <AudienceSwitch active="trainer" />
      <Card title="Welcome back" subtitle="Sign in to your trainer or admin account.">
        <form onSubmit={onSubmit} noValidate>
          <Field
            label="Email"
            required
            name="email"
            type="email"
            autoComplete="email"
            error={errors.email}
          />
          <Field
            label="Password"
            required
            name="password"
            type="password"
            autoComplete="current-password"
            error={errors.password}
          />
          {formError && <Alert>{formError}</Alert>}
          <Button type="submit" loading={busy}>
            Sign in
          </Button>
        </form>
        <div className="links-stack">
          <Link className="links-forgot" href="/forgot-password/">
            Forgot password?
          </Link>
          <div className="links-divider" role="separator">
            <span>or</span>
          </div>
          <p className="links-new">
            New trainer? <Link href="/register/">Create an account</Link>
          </p>
        </div>
      </Card>
    </Shell>
  );
}
