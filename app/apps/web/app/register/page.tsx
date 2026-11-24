'use client';

import Link from 'next/link';
import { AudienceSwitch } from '../../components/audience-switch';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { registerSchema } from '@parakh/shared';
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
import { useRedirectIfSignedIn } from '../../lib/auth';

export default function RegisterPage() {
  useRedirectIfSignedIn(true);
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = validate(registerSchema, {
      role: 'EXAMINER',
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      phone: (form.get('phone') as string) || undefined,
      orgName: (form.get('orgName') as string) || undefined,
      acceptTerms: form.get('acceptTerms') === 'on',
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setFormError('');
    setBusy(true);
    try {
      await api('/auth/register', { method: 'POST', body: result.data, auth: false });
      router.push(`/verify-email/?email=${encodeURIComponent(result.data.email)}`);
    } catch (err) {
      const d = describeError(err);
      setFormError(d.message);
      setErrors(d.fields);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell auth>
      <AudienceSwitch active="trainer" />
      <Card
        title="Create a trainer account"
        subtitle="For trainers. Students do not register, they join with an exam code."
      >
        <form onSubmit={onSubmit} noValidate className="reg-form">
          <Field label="Full name" name="name" autoComplete="name" error={errors.name} required />
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
            autoComplete="new-password"
            hint="10+ characters, a letter and a number."
            error={errors.password}
          />
          <Field label="Phone" name="phone" type="tel" autoComplete="tel" error={errors.phone} />
          <Field
            label="Organisation"
            name="orgName"
            autoComplete="organization"
            error={errors.orgName}
          />
          <label className="consent">
            <input
              type="checkbox"
              name="acceptTerms"
              aria-invalid={errors.acceptTerms ? true : undefined}
            />
            <span>
              I accept the <Link href="/terms/">Terms of use</Link> and the{' '}
              <Link href="/privacy/">Privacy policy</Link>.
              {errors.acceptTerms && <small className="error-text"> {errors.acceptTerms}</small>}
            </span>
          </label>
          {formError && <Alert>{formError}</Alert>}
          <Button type="submit" loading={busy}>
            Create account
          </Button>
        </form>
        <p className="links">
          <span>
            Already registered? <Link href="/login/">Sign in</Link>
          </span>
          <span>
            Taking an exam? <Link href="/join/">Join with your exam code</Link>
          </span>
        </p>
      </Card>
    </Shell>
  );
}
