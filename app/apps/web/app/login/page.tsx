'use client';

import { COPY } from '../../lib/copy';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthResponse, JoinInfoDto } from '@parakh/shared';
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
import { WEBSITE_URL } from '../../lib/site';
import { useAuth } from '../../lib/auth';

export default function LoginPage() {
  useRedirectIfSignedIn(true);
  const router = useRouter();
  const { setSession } = useAuth();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [examCode, setExamCode] = useState('');
  const [examError, setExamError] = useState('');
  const [finding, setFinding] = useState(false);
  const [mode, setMode] = useState<'exam' | 'trainer'>('trainer');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'exam') setMode('exam');
  }, []);

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

  /** Exam code only: once the exam is found, the student lands on its page (details and payment). */
  async function onFindExam(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = examCode.trim();
    if (!value) return;
    setExamError('');
    setFinding(true);
    try {
      const found = await api<JoinInfoDto>(`/join/${encodeURIComponent(value)}`, { auth: false });
      router.push(`/join/?code=${encodeURIComponent(found.code)}`);
    } catch (err) {
      setExamError(
        err instanceof ApiError && err.status === 404
          ? 'No exam found for that code. Check it and try again.'
          : describeError(err).message,
      );
      setFinding(false);
    }
  }

  return (
    <Shell auth>
      <div className="audience-switch" role="tablist" aria-label="What would you like to do?">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'trainer'}
          className={`as-item${mode === 'trainer' ? ' on' : ''}`}
          onClick={() => setMode('trainer')}
        >
          <strong>Conduct exams</strong>
          <small>Trainer or admin sign in</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'exam'}
          className={`as-item${mode === 'exam' ? ' on' : ''}`}
          onClick={() => setMode('exam')}
        >
          <strong>Join an exam</strong>
          <small>With an exam code</small>
        </button>
      </div>

      {mode === 'exam' ? (
        <Card
          title="Join an exam"
          subtitle="Enter the exam code your trainer shared. No password needed."
        >
          <form onSubmit={onFindExam} noValidate>
            <Field
              label="Exam code"
              required
              name="examCode"
              value={examCode}
              onChange={(e) => setExamCode(e.target.value)}
              placeholder="NVX-XXXXXX"
              autoCapitalize="characters"
              autoComplete="off"
            />
            {examError && <Alert>{examError}</Alert>}
            <Button type="submit" loading={finding} disabled={!examCode.trim()}>
              Find exam
            </Button>
          </form>
          <div className="links-stack">
            <div className="links-divider" role="separator">
              <span>or</span>
            </div>
            <p className="links-new">
              No code? <a href={`${WEBSITE_URL}/#exams`}>Browse exams on our website</a>
            </p>
            <p className="links-new">
              Already took an exam? <Link href="/practice/">Practice</Link>
            </p>
          </div>
        </Card>
      ) : (
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
              New trainer? <Link href="/register/">{COPY.createTrainerAccount}</Link>
            </p>
          </div>
        </Card>
      )}
    </Shell>
  );
}
