'use client';

import { SiteLinks } from './legal';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from '../lib/api';
import { WEBSITE_URL } from '../lib/site';
import { useAuth } from '../lib/auth';
import { AppShell, Brand } from './app-shell';
import { Icon, type IconName } from './icons';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/verify',
];

// Pages students use. They get no sidebar, whoever is looking at them.
const STUDENT_PATHS = ['/join', '/practice'];

/**
 * Page frame. Signed-out pages (landing, sign-in, ...) get a centred layout; every other page
 * gets the app shell with the sidebar and top bar.
 */
export function Shell({
  children,
  wide,
  full,
  auth,
  join,
}: {
  children: React.ReactNode;
  wide?: boolean;
  /** Use the same split-screen frame as sign-in, so moving between the two is seamless. */
  auth?: boolean;
  /** The student join page: a full-width page of its own, with no side panel. */
  join?: boolean;
  /** Student pages that use the whole screen width and height instead of a narrow centred column. */
  full?: boolean;
}) {
  const pathname = (usePathname() ?? '/').replace(/(.)\/$/, '$1');
  const { user } = useAuth();
  // Students have no portal: the join and practice pages (and anything a student sees) are a bare
  // page with the brand on top, never the app shell with its sidebar.
  if (join) return <JoinFrame>{children}</JoinFrame>;
  if (auth) return <AuthShell>{children}</AuthShell>;
  const studentPage = STUDENT_PATHS.includes(pathname) || user?.role === 'STUDENT';
  if (studentPage && (!user || user.role === 'STUDENT' || STUDENT_PATHS.includes(pathname))) {
    return (
      <div className="public">
        <header className="public-bar">
          <Brand />
        </header>
        <main className={full ? 'page page-full' : wide ? 'page page-wide' : 'page'}>
          {children}
        </main>
      </div>
    );
  }
  if (!PUBLIC_PATHS.includes(pathname)) return <AppShell narrow={!wide}>{children}</AppShell>;
  if (pathname === '/') return <LandingFrame>{children}</LandingFrame>;
  if (pathname !== '/verify') return <AuthShell>{children}</AuthShell>;
  return (
    <div className="public">
      <header className="public-bar">
        <Brand />
        <div className="public-actions">
          <Link href="/login/" className="btn btn-secondary btn-small btn-link">
            Sign in
          </Link>
          <Link href="/register/" className="btn btn-primary btn-small btn-link">
            Get started
          </Link>
        </div>
      </header>
      <main className={wide ? 'page page-wide' : 'page'}>{children}</main>
    </div>
  );
}

const LANDING_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#certificates', label: 'Certificates' },
  { href: '#verify', label: 'Verify' },
  { href: '#pricing', label: 'Pricing' },
];

/** Full-width frame for the landing page: a sticky glass navigation bar and an edge-to-edge body. */
function LandingFrame({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="lp">
      <header className={`lp-nav${scrolled ? ' lp-nav-scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <Brand />
          <nav className="lp-links" aria-label="Sections">
            {LANDING_LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="public-actions">
            <Link href="/login/" className="btn btn-ghost btn-small btn-link">
              Sign in
            </Link>
            <Link href="/register/" className="btn btn-primary btn-small btn-link">
              Get started
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

const AUTH_POINTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'shield',
    title: 'Proctored, fair exams',
    text: 'Full-screen mode, tab-switch strikes and a violation timeline.',
  },
  {
    icon: 'edit',
    title: 'Multiple choice and written answers',
    text: 'Choice questions are graded automatically. Trainers mark written answers.',
  },
  {
    icon: 'award',
    title: 'Verified certificates',
    text: 'Publish results and issue certificates after review.',
  },
];

/**
 * The student join page: a full-width, full-height page of its own, with no side panel. Just the
 * brand on top and the form centred below.
 */
function JoinFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="join-frame">
      <header className="join-top">
        <Brand />
        <span className="spacer" />
        <Link href="/login/" className="btn btn-ghost btn-small btn-link">
          Trainer sign in
        </Link>
        <a href={WEBSITE_URL} className="btn btn-secondary btn-small btn-link">
          Back to home
        </a>
      </header>
      <main className="join-main">{children}</main>
      <footer className="join-foot">
        <SiteLinks />
        <span>&copy; NandiVex Technologies</span>
      </footer>
    </div>
  );
}

/** Split layout for sign-in, sign-up and password pages: brand panel on the left, form on the right. */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <Brand light />
        <div className="auth-pitch">
          <h2>Run exams you can trust.</h2>
          <p>Create, proctor and grade online exams for quizzes, assessments and certifications.</p>
          <ul>
            {AUTH_POINTS.map((p) => (
              <li key={p.title}>
                <span className="auth-ico">
                  <Icon name={p.icon} size={18} />
                </span>
                <div>
                  <b>{p.title}</b>
                  <span>{p.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview-head">
            <b>Cloud Fundamentals</b>
            <span className="auth-live">Live</span>
          </div>
          <div className="auth-bar">
            <i />
          </div>
          <div className="auth-preview-row">
            <span>Question 25 of 40</span>
            <span>42:18 left</span>
          </div>
          <div className="auth-preview-row">
            <span>Tab switches</span>
            <span>0 of 3</span>
          </div>
        </div>
        <a className="auth-by" href="https://nandivex.com" target="_blank" rel="noreferrer">
          A product of NandiVex Technologies, nandivex.com
        </a>
      </aside>
      <div className="auth-main">
        <header className="auth-top">
          <span className="auth-top-brand">
            <Brand />
          </span>
          <span className="spacer" />
          <a href={WEBSITE_URL} className="btn btn-secondary btn-small btn-link">
            Back to home
          </a>
        </header>
        <main className="auth-form">{children}</main>
        <footer className="auth-foot">
          <SiteLinks />
          <span>&copy; NandiVex Technologies</span>
        </footer>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  note,
  icon,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  icon: IconName;
  highlight?: boolean;
}) {
  return (
    <div className={`stat${highlight ? ' stat-hl' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon-wrap">
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

const BADGE_KIND: Record<string, string> = {
  PAYMENT_PENDING: 'warn',
  PUBLISHED: 'info',
  LIVE: 'success',
  GRADING: 'warn',
  RESULTS_FINAL: 'success',
  CERT_PENDING_APPROVAL: 'warn',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CANCELLED: 'danger',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const kind = BADGE_KIND[status];
  const text = label ?? status.replace(/_/g, ' ').toLowerCase();
  return (
    <span className={`badge${kind ? ' badge-' + kind : ''}`}>
      <span className="badge-dot" />
      {text}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  const icon: IconName = kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info';
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="alert-ico">
        <Icon name={icon} size={18} />
      </span>
      <div className="alert-body">{children}</div>
    </div>
  );
}

/** Red asterisk marking a required field. Screen readers get aria-required on the input instead. */
export function Req() {
  return (
    <b className="req" aria-hidden="true">
      {' '}
      *
    </b>
  );
}

/** `required` only marks the field (red asterisk); the form's own checks decide what is valid. */
export function Field({
  label,
  name,
  error,
  hint,
  required,
  ...props
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'required'>) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <Req />}
      </span>
      <input
        name={name}
        id={name}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="error-text">{error}</small>}
    </label>
  );
}

export function Button({
  loading,
  children,
  variant = 'primary',
  small,
  ...props
}: {
  loading?: boolean;
  small?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`btn btn-${variant}${small ? ' btn-small' : ''}`}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="btn-spinner" aria-hidden="true" />
          Please wait…
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Reads ?name=value on the client (static export has no server-side search params). */
export function useQueryParam(name: string): string {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name) ?? '');
  }, [name]);
  return value;
}

export type FieldErrors = Record<string, string | undefined>;

/** Validates with a shared zod schema and returns either the data or per-field messages. */
export function validate<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Turns an API error into a form message plus per-field messages. */
export function describeError(err: unknown): { message: string; fields: FieldErrors } {
  if (err instanceof ApiError) {
    const fields: FieldErrors = {};
    for (const [key, messages] of Object.entries(err.fieldErrors ?? {})) fields[key] = messages[0];
    return {
      message: err.fieldErrors ? 'Please fix the highlighted fields.' : err.message,
      fields,
    };
  }
  return {
    message: 'Could not reach the server. Check your connection and try again.',
    fields: {},
  };
}

/**
 * Keyboard behaviour for a modal dialog: focus moves into it when it opens, Tab stays inside,
 * Escape closes it, and focus returns to where it was when it closes.
 */
export function useModalFocus(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    const before = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        box.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea',
        ),
      );
    focusable()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab') {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open, ref]);
}
