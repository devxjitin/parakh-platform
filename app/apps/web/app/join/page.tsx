'use client';

import Link from 'next/link';
import { Icon } from '../../components/icons';
import { Brand } from '../../components/app-shell';
import { AudienceSwitch } from '../../components/audience-switch';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AttemptDto,
  AuthResponse,
  EnrollmentDto,
  JoinInfoDto,
  PublishOrderDto,
} from '@parakh/shared';
import { Alert, Button, Card, Shell, describeError, useQueryParam, Req } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { runCheckout } from '../../lib/checkout';

const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'not set');

type Step = 'code' | 'details' | 'otp' | 'seat';

const STEP_LABELS: [Step, string][] = [
  ['code', 'Exam code'],
  ['details', 'Your details'],
  ['otp', 'Email code'],
  ['seat', 'Fee and start'],
];

function StepDots({ step }: { step: Step }) {
  const at = STEP_LABELS.findIndex(([x]) => x === step);
  return (
    <div
      className="step-dots"
      role="img"
      aria-label={`Step ${at + 1} of ${STEP_LABELS.length}: ${STEP_LABELS[at]?.[1] ?? ''}`}
    >
      {STEP_LABELS.map(([x], i) => (
        <i key={x} className={i === at ? 'on' : i < at ? 'done' : ''} />
      ))}
    </div>
  );
}

/** 24 Nov 2026, 5:00 AM */
const whenShort = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'Not set';

function JoinSummary({ info, ended }: { info: JoinInfoDto; ended: boolean }) {
  const by = `${info.trainerName}${info.orgName ? `, ${info.orgName}` : ''}`;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    <div className="join-summary">
      <div className="js-top">
        <span className="js-avatar" aria-hidden="true">
          {info.title.trim().charAt(0).toUpperCase() || 'E'}
        </span>
        <div className="js-title">
          <h2>{info.title}</h2>
          <p>By {by}</p>
        </div>
        <span className={`js-fee${info.feePaise === 0 ? ' free' : ''}`}>
          {info.feePaise === 0 ? 'Free' : rupees(info.feePaise)}
        </span>
      </div>
      {info.description && <p className="js-desc">{info.description}</p>}
      <dl className="js-stats">
        <div>
          <dt>{plural(info.questionCount, 'Question', 'Questions')}</dt>
          <dd>{info.questionCount}</dd>
        </div>
        <div>
          <dt>{plural(info.totalMarks, 'Mark', 'Marks')}</dt>
          <dd>{info.totalMarks}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>
            {info.durationMinutes}
            <small> min</small>
          </dd>
        </div>
      </dl>
      <div className="js-when">
        <div>
          <span>Opens</span>
          <b>{whenShort(info.startsAt)}</b>
        </div>
        <i aria-hidden="true" />
        <div>
          <span>Closes</span>
          <b>{whenShort(info.endsAt)}</b>
        </div>
      </div>
      {ended && <Alert>This exam has ended and can no longer be joined.</Alert>}
    </div>
  );
}

function parts(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="wr-tile">
      <span className="wr-digits">{String(value).padStart(2, '0')}</span>
      <span className="wr-unit">{label}</span>
    </div>
  );
}

/** Shown after joining, until the exam opens: a live countdown, then the exam starts by itself. */
function WaitingRoom({
  info,
  name,
  email,
  startsAt,
  starting,
  notice,
  problem,
  onStart,
  busy,
}: {
  info: JoinInfoDto;
  name: string;
  email: string;
  startsAt: number;
  starting: boolean;
  notice?: string;
  problem?: string;
  onStart: () => void;
  busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  const left = startsAt - now;
  const live = starting || left <= 0;
  const t = parts(left);
  const startLabel = new Date(startsAt).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const clock: [string, number][] = [
    ...(t.days > 0 ? ([['Days', t.days]] as [string, number][]) : []),
    ['Hours', t.hours],
    ['Minutes', t.minutes],
    ['Seconds', t.seconds],
  ];
  const rules = [
    {
      icon: 'clock' as const,
      text: 'Keep this page open. The exam opens on its own at the start time.',
    },
    { icon: 'zap' as const, text: 'Use a stable internet connection and keep this tab in front.' },
    {
      icon: 'timer' as const,
      text: 'The timer runs on our server and keeps counting if you leave or refresh.',
    },
    { icon: 'eye' as const, text: 'Switching tabs or windows during the exam may be recorded.' },
    {
      icon: 'mail' as const,
      text: 'Your score, answer key and certificate are emailed after you submit.',
    },
  ];

  return (
    <main className="gate gate-start gate-wait" role="status" aria-live="polite">
      <section className="wr-hero gate-hero">
        <div className="gw-top">
          <Brand light />
          {!online && (
            <div className="gw-conn off">
              <span className="wr-dot" aria-hidden="true" />
              Offline
            </div>
          )}
        </div>

        <div className="gw-main">
          <h2 className="wr-title">{info.title}</h2>
          <p className="wr-by">
            By {info.trainerName}
            {info.orgName ? `, ${info.orgName}` : ''}
          </p>

          {live ? (
            <div className="wr-live">
              <span className="wr-spinner" aria-hidden="true" />
              <div>
                <b>Starting your exam</b>
                <small>Taking you in now. Please do not close this page.</small>
              </div>
            </div>
          ) : (
            <>
              <p className="wr-label">Your exam starts in</p>
              <div className="gate-clock" role="timer" aria-label="Time until the exam starts">
                {clock.map(([unit, value], i) => (
                  <div className="gate-clock-part" key={unit}>
                    {i > 0 && <span className="gate-clock-sep">:</span>}
                    <div className="wr-tile">
                      <span className="wr-digits">{String(value).padStart(2, '0')}</span>
                      <span className="wr-unit">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="wr-when">
                Scheduled for <b>{startLabel}</b>
              </p>
            </>
          )}

          {problem && <p className="gw-msg bad">{problem}</p>}
          {notice && <p className="gw-msg">{notice}</p>}
        </div>
      </section>

      <aside className="gate-side">
        <div className="wr-panel">
          <h3>Candidate</h3>
          <div className="gw-cand">
            <span className="gw-avatar" aria-hidden="true">
              {name.trim().charAt(0).toUpperCase() || 'S'}
            </span>
            <div>
              <b>{name}</b>
              <span>{email}</span>
            </div>
          </div>
        </div>
        <div className="wr-panel">
          <h3>Exam details</h3>
          <dl className="wr-facts">
            <div>
              <dt>Questions</dt>
              <dd>{info.questionCount}</dd>
            </div>
            <div>
              <dt>Total marks</dt>
              <dd>{info.totalMarks}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{info.durationMinutes} min</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{when(info.endsAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="wr-panel">
          <h3>Before you begin</h3>
          <ul className="gs-rules">
            {rules.map((r) => (
              <li key={r.text}>
                <span className="gs-ico" aria-hidden="true">
                  <Icon name={r.icon} size={17} />
                </span>
                <p>{r.text}</p>
              </li>
            ))}
          </ul>
        </div>
        <Button disabled={!live} loading={live && busy} onClick={onStart}>
          Start exam
        </Button>
        {!live && <p className="gw-start-note">The button unlocks when the exam starts.</p>}
      </aside>
    </main>
  );
}

/** Whether the exam has already closed for joining. */
const ended0 = (i: JoinInfoDto | null) => i?.state === 'ENDED';

export default function JoinPage() {
  const auth = useAuth();
  const queryCode = useQueryParam('code');
  const [step, setStep] = useState<Step>('code');
  // Which way the page turns: forward through the steps, or back.
  const lastStep = useRef<Step>('code');
  const ORDER: Step[] = ['code', 'details', 'otp', 'seat'];
  const going = ORDER.indexOf(step) >= ORDER.indexOf(lastStep.current) ? 'fwd' : 'back';
  useEffect(() => {
    lastStep.current = step;
  }, [step]);
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<JoinInfoDto | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accept, setAccept] = useState(false);
  const [otp, setOtp] = useState('');
  const [seat, setSeat] = useState<EnrollmentDto | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const student = auth.user?.role === 'STUDENT' ? auth.user : null;

  const fail = (err: unknown) =>
    setError(
      err instanceof Error && !(err instanceof ApiError) ? err.message : describeError(err).message,
    );

  /** After the email is proven: find this student's seat, if they already have one. */
  const loadSeat = useCallback(async (examCode: string) => {
    setSeat(await api<EnrollmentDto | null>(`/join/${encodeURIComponent(examCode)}/mine`));
    setStep('seat');
  }, []);

  const lookup = useCallback(async (value: string) => {
    setError('');
    setInfo(null);
    if (!value.trim()) return;
    setBusy(true);
    try {
      const found = await api<JoinInfoDto>(`/join/${encodeURIComponent(value.trim())}`, {
        auth: false,
      });
      setInfo(found);
      setCode(found.code);
      try {
        window.history.replaceState(null, '', `/join/?code=${encodeURIComponent(found.code)}`);
      } catch {
        // not critical
      }
      return found;
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'No exam found for that code. Check it and try again.'
          : describeError(err).message,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // A link with ?code= opens straight onto the exam (once; later session changes must not reset it).
  const opened = useRef(false);
  useEffect(() => {
    if (!queryCode || auth.loading || opened.current) return;
    opened.current = true;
    void lookup(queryCode).then(async (found) => {
      if (!found) return;
      if (student) {
        // Already verified on this device: no need to type the email and code again.
        setName(student.name);
        setEmail(student.email);
        try {
          await loadSeat(found.code);
          return;
        } catch {
          // fall through to the normal steps
        }
      }
      setStep('details');
    });
  }, [queryCode, auth.loading, student, lookup, loadSeat]);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setError('');
    setBusy(true);
    try {
      await api(`/auth/join/${encodeURIComponent(info.code)}/start`, {
        method: 'POST',
        auth: false,
        body: { name, email, acceptTerms: accept },
      });
      setOtp('');
      setStep('otp');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setError('');
    setBusy(true);
    try {
      const session = await api<AuthResponse>('/auth/join/verify', {
        method: 'POST',
        auth: false,
        body: { name, email, code: otp },
      });
      auth.setSession(session);
      await loadSeat(info.code);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function takeSeat() {
    if (!info || !auth.user) return;
    setError('');
    setNote('');
    setBusy(true);
    try {
      if (info.feePaise === 0) {
        await api(`/join/${encodeURIComponent(info.code)}/enroll`, { method: 'POST' });
      } else {
        const order = await api<PublishOrderDto>(`/join/${encodeURIComponent(info.code)}/order`, {
          method: 'POST',
        });
        const outcome = await runCheckout(order, { name: auth.user.name, email: auth.user.email });
        if (outcome.simulated)
          setNote('Test mode: this payment was simulated and no money was charged.');
        if (!outcome.result) return;
      }
      await loadSeat(info.code);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const startsAtMs = info?.startsAt ? new Date(info.startsAt).getTime() : null;
  const waiting = step === 'seat' && !!seat && !seat.canStart && !seat.attempt && !ended0(info);
  const [starting, setStarting] = useState(false);

  // While waiting: once the start time passes, ask the server every couple of seconds and begin
  // the moment it allows it. The student never has to come back and sign in again.
  useEffect(() => {
    if (!waiting || startsAtMs === null || !info) return;
    let stop = false;
    const tick = async () => {
      if (stop || Date.now() < startsAtMs - 1500) return;
      setStarting(true);
      try {
        const fresh = await api<EnrollmentDto | null>(
          `/join/${encodeURIComponent(info.code)}/mine`,
        );
        if (stop || !fresh) return;
        if (fresh.canStart) {
          stop = true;
          const attempt =
            fresh.attempt ??
            (await api<AttemptDto>('/attempts', {
              method: 'POST',
              body: { enrollmentId: fresh.enrollmentId },
            }));
          window.location.href = `/attempt/?id=${attempt.id}`;
        }
      } catch {
        // try again on the next tick
      }
    };
    const t = setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [waiting, startsAtMs, info]);

  async function begin() {
    if (!seat) return;
    setError('');
    setBusy(true);
    try {
      const attempt =
        seat.attempt ??
        (await api<AttemptDto>('/attempts', {
          method: 'POST',
          body: { enrollmentId: seat.enrollmentId },
        }));
      window.location.href = `/attempt/?id=${attempt.id}`;
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  if (auth.loading) {
    return (
      <Shell auth>
        <AudienceSwitch active="join" />
        <Card title="Join an exam">
          <p className="muted">Loading…</p>
        </Card>
      </Shell>
    );
  }
  if (auth.user && auth.user.role !== 'STUDENT') {
    return (
      <Shell auth>
        <AudienceSwitch active="join" />
        <Alert>
          You are signed in as a{' '}
          {auth.user.role === 'ADMIN' ? 'NandiVex Technologies admin' : 'trainer'}. Sign out to join
          an exam as a student, using a different email.
        </Alert>
      </Shell>
    );
  }

  const ended = info?.state === 'ENDED';

  if (!waiting) {
    return (
      <Shell auth>
        <AudienceSwitch active="join" />
        <Card title="Join an exam" subtitle="No account needed. Just your name and email.">
          <StepDots step={step} />
          {error && <Alert>{error}</Alert>}
          {note && <Alert kind="info">{note}</Alert>}
          <div key={step} className={`join-page ${going}`}>
            {info && step !== 'code' && <JoinSummary info={info} ended={ended} />}
            {step === 'code' && (
              <>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await lookup(code)) setStep('details');
                  }}
                >
                  <label className="field">
                    <span>
                      Exam code
                      <Req />
                    </span>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="NVX-XXXXXX"
                      autoCapitalize="characters"
                      autoComplete="off"
                    />
                  </label>
                  <Button type="submit" loading={busy} disabled={!code.trim()}>
                    Find exam
                  </Button>
                </form>
                <p className="muted" style={{ marginTop: 16 }}>
                  Already took an exam? Open your practice page with the code we emailed you:{' '}
                  <Link href="/practice/">Practice</Link>.
                </p>
                <details className="join-how-box">
                  <summary>How joining works</summary>
                  <ol className="join-how">
                    <li>Enter the exam code your trainer shared.</li>
                    <li>Give your name and email, then enter the 6-digit code we send.</li>
                    <li>Pay the fee (if any) and wait on the countdown screen.</li>
                    <li>The exam starts by itself at the scheduled time.</li>
                    <li>Your score, answer key and certificate are emailed after you submit.</li>
                  </ol>
                </details>
              </>
            )}

            {info && !ended && step === 'details' && (
              <div className="join-step">
                <h2 style={{ marginTop: 0 }}>Your details</h2>
                <form onSubmit={sendCode}>
                  <label className="field">
                    <span>
                      Full name (as it should appear on your certificate)
                      <Req />
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>
                      Email
                      <Req />
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={accept}
                      onChange={(e) => setAccept(e.target.checked)}
                    />
                    <span>
                      I accept the <Link href="/terms/">Terms of use</Link> and the{' '}
                      <Link href="/privacy/">Privacy policy</Link>.
                    </span>
                  </label>
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={!accept || name.trim().length < 2 || !email}
                  >
                    Email me a code
                  </Button>
                </form>
              </div>
            )}
            {info && step === 'otp' && (
              <div className="join-step">
                <h2 style={{ marginTop: 0 }}>Enter the code we emailed you</h2>
                <p className="muted">We sent a 6-digit code to {email}.</p>
                <form onSubmit={verify}>
                  <label className="field">
                    <span>
                      6-digit code
                      <Req />
                    </span>
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                    />
                  </label>
                  <Button type="submit" loading={busy} disabled={otp.length !== 6}>
                    Verify
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setStep('details')}>
                    Change email
                  </Button>
                </form>
              </div>
            )}
            {info && step === 'seat' && (
              <div className="join-step">
                {seat ? (
                  seat.canStart ? (
                    <div className="seat-box ok">
                      <span className="seat-ico" aria-hidden="true">
                        <Icon name="check" size={20} />
                      </span>
                      <div>
                        <h2>You are in</h2>
                        <p>
                          Your seat is confirmed
                          {info.feePaise > 0 ? ', and a receipt was emailed to you' : ''}.
                        </p>
                      </div>
                      <Button loading={busy} onClick={begin}>
                        {seat.attempt ? 'Resume exam' : 'Start exam'}
                      </Button>
                    </div>
                  ) : (
                    <div className="seat-box ok">
                      <span className="seat-ico" aria-hidden="true">
                        <Icon name="check" size={20} />
                      </span>
                      <div>
                        <h2>Exam submitted</h2>
                        <p>Your result and certificate (if any) are sent by email.</p>
                      </div>
                    </div>
                  )
                ) : ended ? null : (
                  <div className="seat-box">
                    <h2>{info.feePaise === 0 ? 'Take your seat' : 'Pay the exam fee'}</h2>
                    {info.feePaise > 0 && (
                      <div className="pay-row">
                        <div>
                          <span>Exam fee</span>
                          <small>Inclusive of applicable taxes</small>
                        </div>
                        <b>{rupees(info.feePaise)}</b>
                      </div>
                    )}
                    <Button loading={busy} onClick={takeSeat}>
                      {info.feePaise > 0
                        ? `Pay ${rupees(info.feePaise)} and join`
                        : 'Join for free'}
                    </Button>
                    {info.feePaise > 0 && (
                      <p className="pay-note">
                        <Icon name="shield" size={14} />
                        <span>
                          A receipt is emailed to you. Once you pay, the seat is yours and the fee
                          is not refunded. See the <Link href="/refund-policy/">refund policy</Link>
                          .
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </Shell>
    );
  }

  // Only the waiting room is left: a full-screen page with the countdown, no scrolling.
  if (!info || !seat) return null;
  return (
    <WaitingRoom
      info={info}
      name={auth.user?.name ?? name}
      email={auth.user?.email ?? email}
      startsAt={info.startsAt ? new Date(info.startsAt).getTime() : Date.now()}
      starting={starting}
      notice={note}
      problem={error}
      onStart={() => void begin()}
      busy={busy}
    />
  );
}
