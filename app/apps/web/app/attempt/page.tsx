'use client';

import Link from 'next/link';
import { QuestionImage, QuestionText } from '../../components/question-content';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutosaveQueue,
  type AttemptAnswerDto,
  type AttemptDto,
  type AttemptTimingDto,
  type ProctorEventType,
  type SaveAnswerInput,
  type SendResult,
} from '@parakh/shared';
import { Alert, Button, useModalFocus, useQueryParam } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ApiError, api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';

type SaveState = 'saved' | 'saving' | 'error';

const TIMING_POLL_MS = 10_000;
const TIMING_RECHECK_MS = 2_000;

const END_TEXT: Record<string, string> = {
  SUBMITTED_BY_STUDENT: 'You submitted your exam.',
  TIME_UP: 'Time ran out, so your exam was submitted automatically.',
  STRIKES:
    'Your exam was submitted automatically after too many warnings for leaving the exam screen.',
};

function clock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const isAnswered = (a?: AttemptAnswerDto) => Boolean(a && (a.selected.length > 0 || a.text.trim()));
const blank = (): AttemptAnswerDto => ({ selected: [], text: '', flagged: false });

export default function AttemptPage() {
  const { user, loading } = useRequireAuth();
  const id = useQueryParam('id');
  const [attempt, setAttempt] = useState<AttemptDto | null>(null);
  const [answers, setAnswers] = useState<Record<string, AttemptAnswerDto>>({});
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [begun, setBegun] = useState(false);
  const [fullscreen, setFullscreen] = useState(true);
  const [warning, setWarning] = useState('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Desktop: the navigator is a full panel, a slim rail, or hidden. Remembered on this device.
  const [navMode, setNavModeState] = useState<'full' | 'slim' | 'hidden'>('full');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('parakh.exam.nav');
      if (saved === 'slim' || saved === 'hidden') setNavModeState(saved);
    } catch {
      /* not remembered */
    }
  }, []);
  const setNavMode = (mode: 'full' | 'slim' | 'hidden') => {
    setNavModeState(mode);
    try {
      window.localStorage.setItem('parakh.exam.nav', mode);
    } catch {
      /* not remembered */
    }
  };
  const [announce, setAnnounce] = useState('');
  const announced = useRef(new Set<number>());
  const modalRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useModalFocus(confirmSubmit, modalRef, () => setConfirmSubmit(false));

  // Screen readers hear the time left only at a few points, not every second.
  useEffect(() => {
    if (remaining === null) return;
    for (const mins of [10, 5, 1]) {
      if (remaining <= mins * 60 && remaining > 0 && !announced.current.has(mins)) {
        announced.current.add(mins);
        setAnnounce(`${mins} minute${mins === 1 ? '' : 's'} left`);
        // A smaller mark that is already past is not announced late.
        for (const bigger of [10, 5, 1]) if (bigger > mins) announced.current.add(bigger);
      }
    }
  }, [remaining]);
  const [submitting, setSubmitting] = useState(false);

  const serverClockOffset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ended = useRef(false);
  const latest = useRef<Record<string, AttemptAnswerDto>>({});
  const unsentEvents = useRef<ProctorEventType[]>([]);
  const [unsaved, setUnsaved] = useState(0);

  // One queue per attempt: a single save in flight, rising sequence numbers, and a copy of
  // unsaved answers in localStorage so a refresh or crash while offline loses nothing.
  const queue = useMemo(() => {
    if (!attempt) return null;
    const key = `aiq-pending-${attempt.id}`;
    return new AutosaveQueue<AttemptAnswerDto>({
      storage: {
        get: () => window.localStorage.getItem(key),
        set: (v) => window.localStorage.setItem(key, v),
        remove: () => window.localStorage.removeItem(key),
      },
      send: async (qid, value, seq): Promise<SendResult> => {
        const body: SaveAnswerInput = {
          selected: value.selected,
          text: value.text,
          flagged: value.flagged,
          seq,
        };
        try {
          await api(`/attempts/${attempt.id}/answers/${qid}`, { method: 'PUT', body });
          return 'ok';
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) return 'ended';
          if (err instanceof ApiError && err.code === 'DEVICE_MISMATCH') {
            setFatal(err.message);
            return 'fatal';
          }
          return 'retry';
        }
      },
    });
  }, [attempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- loading
  useEffect(() => {
    if (!id || user?.role !== 'STUDENT') return;
    api<AttemptDto>(`/attempts/${id}`)
      .then((a) => {
        serverClockOffset.current = Date.parse(a.serverTime) - performance.now();
        setAttempt(a);
        setAnswers(a.answers);
        latest.current = a.answers;
        ended.current = a.status !== 'IN_PROGRESS';
      })
      .catch((err) =>
        setFatal(
          err instanceof ApiError && err.code === 'DEVICE_MISMATCH'
            ? err.message
            : err instanceof ApiError && err.status === 404
              ? 'This exam attempt was not found.'
              : 'Could not load the exam. Check your connection and refresh.',
        ),
      );
  }, [id, user]);

  const live = attempt?.status === 'IN_PROGRESS';
  const attemptId = attempt?.id;
  const deadlineAt = attempt?.deadlineAt;

  // --------------------------------------------------------------- autosave
  const flush = useCallback(async () => {
    if (!queue) return 'saved' as const;
    setSaveState('saving');
    const res = await queue.flush();
    setUnsaved(queue.size);
    if (res === 'ended') {
      window.location.reload();
    } else if (res === 'failed') {
      setSaveState('error');
      timer.current = setTimeout(() => void flush(), 3000);
    } else if (res === 'saved') {
      setSaveState('saved');
    }
    return res;
  }, [queue]);

  // Brings back answers typed while offline (before a refresh or crash), then saves them.
  useEffect(() => {
    if (!queue || !live) return;
    const restored = queue.restore();
    if (Object.keys(restored).length > 0) {
      latest.current = { ...latest.current, ...restored };
      setAnswers(latest.current);
      setUnsaved(queue.size);
      void flush();
    }
  }, [queue, live, flush]);

  const change = useCallback(
    (qid: string, patch: SaveAnswerInput) => {
      if (!queue) return;
      const cur = latest.current[qid] ?? blank();
      const next: AttemptAnswerDto = {
        selected: patch.selected ?? cur.selected,
        text: patch.text ?? cur.text,
        flagged: patch.flagged ?? cur.flagged,
      };
      latest.current = { ...latest.current, [qid]: next };
      setAnswers(latest.current);
      // The whole answer is queued each time, so a late older save can never drop a newer field.
      queue.set(qid, next);
      setUnsaved(queue.size);
      setSaveState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 500);
    },
    [queue, flush],
  );

  // ----------------------------------------------------------------- submit
  const submit = useCallback(async () => {
    if (!attempt || ended.current) return;
    setSubmitting(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      const saved = queue ? await queue.flushWithRetries(3, 1000) : 'saved';
      setUnsaved(queue?.size ?? 0);
      if (saved === 'ended') {
        window.location.reload();
        return;
      }
      if (saved !== 'saved') {
        // Do not submit with answers the server does not have yet. The timer keeps running and
        // the server submits at the deadline anyway.
        setSaveState('error');
        setError(
          `Your last ${queue?.size ?? 0} answer(s) are not saved yet, so the exam was not submitted. Check your connection; we keep retrying.`,
        );
        timer.current = setTimeout(() => void flush(), 3000);
        return;
      }
      const done = await api<AttemptDto>(`/attempts/${attempt.id}/submit`, { method: 'POST' });
      ended.current = true;
      setAttempt(done);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      setError('Could not submit. Check your connection and try again.');
    } finally {
      setSubmitting(false);
      setConfirmSubmit(false);
    }
  }, [attempt, flush, queue]);

  // Sync the deadline without fetching or overwriting the student's answers.
  useEffect(() => {
    if (!attemptId || !deadlineAt || !live || fatal) return;
    const deadline = Date.parse(deadlineAt);
    let active = true;
    let syncing = false;
    let reachedZero = false;
    let nextSync = performance.now() + TIMING_POLL_MS;

    async function syncTiming() {
      if (!active || syncing || ended.current) return;
      syncing = true;
      try {
        const timing = await api<AttemptTimingDto>(`/attempts/${attemptId}/timing`);
        if (!active || ended.current) return;
        serverClockOffset.current = Date.parse(timing.serverTime) - performance.now();
        if (timing.status !== 'IN_PROGRESS' || timing.deadlineAt !== deadlineAt) {
          setAttempt((current) =>
            current?.status === 'IN_PROGRESS' && current.id === attemptId
              ? { ...current, ...timing }
              : current,
          );
        }
        if (timing.status !== 'IN_PROGRESS') {
          ended.current = true;
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        }
      } catch (err) {
        if (active && err instanceof ApiError && err.code === 'DEVICE_MISMATCH') {
          setFatal(err.message);
        }
      } finally {
        syncing = false;
        nextSync = performance.now() + (reachedZero ? TIMING_RECHECK_MS : TIMING_POLL_MS);
      }
    }

    const tick = () => {
      const now = performance.now();
      const left = Math.max(0, Math.ceil((deadline - (now + serverClockOffset.current)) / 1000));
      setRemaining(left);
      if (left === 0 && !reachedZero) {
        reachedZero = true;
        if (queue?.size) void flush();
        // Only the server can end a timed attempt, using its current deadline.
        void syncTiming();
      } else if (now >= nextSync) {
        void syncTiming();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    window.addEventListener('online', syncTiming);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('online', syncTiming);
    };
  }, [attemptId, deadlineAt, live, fatal, queue, flush]);

  // -------------------------------------------------------------- proctoring
  const report = useCallback(
    async (type: ProctorEventType) => {
      if (!attempt || ended.current) return;
      const key = `aiq-events-${attempt.id}`;
      const keep = () => {
        try {
          if (unsentEvents.current.length === 0) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(unsentEvents.current));
        } catch {
          // Storage unavailable: events only live in memory.
        }
      };
      if (unsentEvents.current.length === 0) {
        try {
          const stored = window.localStorage.getItem(key);
          if (stored) unsentEvents.current = JSON.parse(stored);
        } catch {
          // ignore
        }
      }
      unsentEvents.current.push(type);
      if (unsentEvents.current.length > 200) unsentEvents.current.shift();
      keep();
      const batch = unsentEvents.current.slice(0, 50);
      try {
        const res = await api<{ strikes: number; ended: boolean }>(
          batch.length === 1
            ? `/attempts/${attempt.id}/events`
            : `/attempts/${attempt.id}/events/batch`,
          {
            method: 'POST',
            body:
              batch.length === 1 ? { type: batch[0] } : { events: batch.map((t) => ({ type: t })) },
          },
        );
        unsentEvents.current = unsentEvents.current.slice(batch.length);
        keep();
        if (res.ended) {
          window.location.reload();
          return;
        }
        setAttempt((a) => (a ? { ...a, strikes: res.strikes } : a));
        if (
          attempt.strikePolicy !== 'OFF' &&
          ['TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT'].includes(type)
        ) {
          setWarning(
            attempt.strikePolicy === 'AUTO_SUBMIT'
              ? `Warning ${res.strikes} of ${attempt.maxStrikes}: stay on the exam screen. ${attempt.maxStrikes} warnings submit your exam automatically.`
              : `Warning ${res.strikes}: please stay on the exam screen. Your trainer can see this.`,
          );
        }
      } catch {
        // Offline: the event stays queued and goes out in a batch with the next one.
      }
    },
    [attempt],
  );

  useEffect(() => {
    if (!live || !begun) return;
    // A blur shorter than this (a notification, a password-manager popup) is not reported.
    let pendingAway: ReturnType<typeof setTimeout> | null = null;
    const away = (type: ProctorEventType) => {
      if (pendingAway) return;
      pendingAway = setTimeout(() => {
        pendingAway = null;
        if (document.hidden || !document.hasFocus()) void report(type);
      }, 1500);
    };
    const back = () => {
      if (pendingAway) clearTimeout(pendingAway);
      pendingAway = null;
    };
    const onVisibility = () => (document.hidden ? away('TAB_HIDDEN') : back());
    const onBlur = () => away('WINDOW_BLUR');
    const onFullscreen = () => {
      const inFs = Boolean(document.fullscreenElement);
      setFullscreen(inFs);
      if (!inFs) void report('FULLSCREEN_EXIT');
    };
    const block = (type: ProctorEventType) => (e: Event) => {
      e.preventDefault();
      void report(type);
    };
    const onCopy = block('COPY');
    const onPaste = block('PASTE');
    const onMenu = block('CONTEXT_MENU');
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k)) ||
        (e.ctrlKey && k === 'u')
      ) {
        e.preventDefault();
        void report('DEVTOOLS_KEY');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', back);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', back);
      back();
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('keydown', onKey);
    };
  }, [live, begun, report]);

  // Warn before closing the tab while answers are unsaved.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (live && (saveState !== 'saved' || unsaved > 0 || begun)) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [live, saveState, unsaved, begun]);

  function begin() {
    // Do not wait for the browser: some refuse or never answer, and the exam must still start.
    if (typeof document.documentElement.requestFullscreen === 'function') {
      try {
        void document.documentElement.requestFullscreen()?.catch(() => undefined);
      } catch {
        // Refused: the exam proceeds without it.
      }
    } else {
      // iOS Safari and some tablets have no full screen. Note it for the trainer, never penalise.
      void report('FULLSCREEN_UNSUPPORTED');
    }
    setBegun(true);
  }

  // ------------------------------------------------------------------ views
  if (loading || !user)
    return (
      <main className="gate gate-single">
        <p className="muted">Loading...</p>
      </main>
    );
  if (user.role !== 'STUDENT') {
    return (
      <main className="gate gate-single">
        <Alert>Only students take exams.</Alert>
      </main>
    );
  }
  if (fatal) {
    return (
      <main className="gate gate-single">
        <Alert>{fatal}</Alert>
        <Link href="/join/">Back to the join page</Link>
      </main>
    );
  }
  if (!attempt)
    return (
      <main className="gate gate-single">
        <p className="muted">Loading exam...</p>
      </main>
    );

  if (!live) {
    const steps = [
      {
        icon: 'check' as const,
        title: 'Answers saved',
        text: 'Everything you answered is stored. You can close this page.',
      },
      {
        icon: 'mail' as const,
        title: 'Result by email',
        text: 'Your score, answer key and certificate are emailed as soon as marking is complete: right away for choice-only exams, after your trainer marks written answers otherwise.',
      },
      {
        icon: 'book' as const,
        title: 'Practice code',
        text: 'A practice code for the same questions follows after the exam closes.',
      },
    ];
    return (
      <main className="gate gate-start gate-done">
        <section className="wr-hero gate-hero">
          <span className="done-mark" aria-hidden="true">
            <Icon name="check" size={30} />
          </span>
          <h1 className="wr-title">Exam submitted</h1>
          <p className="wr-by">{attempt.exam.title}</p>
          <p className="gate-lead">
            {END_TEXT[attempt.endReason ?? ''] ?? 'Your exam has been submitted.'}
          </p>
          <div className="gate-info">
            <div className="gate-info-card">
              <h3>Exam</h3>
              <dl>
                <div>
                  <dt>Questions</dt>
                  <dd>{attempt.exam.questionCount}</dd>
                </div>
                <div>
                  <dt>Total marks</dt>
                  <dd>{attempt.exam.totalMarks}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{attempt.exam.durationMinutes} min</dd>
                </div>
                {attempt.exam.code && (
                  <div>
                    <dt>Exam code</dt>
                    <dd>{attempt.exam.code}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="gate-info-card">
              <h3>Candidate</h3>
              <div className="gate-student">
                <span className="gate-avatar" aria-hidden="true">
                  {attempt.student.name.trim().charAt(0).toUpperCase() || 'S'}
                </span>
                <div>
                  <b>{attempt.student.name}</b>
                  <span>{attempt.student.email}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <aside className="gate-side">
          <div className="wr-panel">
            <h3>What happens next</h3>
            <ol className="next-steps">
              {steps.map((st) => (
                <li key={st.title}>
                  <span className="next-ico" aria-hidden="true">
                    <Icon name={st.icon} size={18} />
                  </span>
                  <div>
                    <b>{st.title}</b>
                    <p>{st.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link href="/" className="btn btn-primary btn-link done-home">
              Go to home page
            </Link>
          </div>
        </aside>
      </main>
    );
  }

  if (!begun) {
    const warnings = `${attempt.strikes} warning${attempt.strikes === 1 ? '' : 's'}`;
    const late =
      remaining !== null && remaining < attempt.exam.durationMinutes * 60 - 60
        ? Math.max(0, Math.ceil(remaining / 60))
        : null;
    const nQ = attempt.questions.length;
    return (
      <main className="gate gate-start">
        <section className="wr-hero gate-hero">
          <h1 className="wr-title">{attempt.exam.title}</h1>
          <p className="wr-by">
            By {attempt.exam.trainerName}
            {attempt.exam.orgName ? `, ${attempt.exam.orgName}` : ''}
          </p>

          <p className="wr-label">Time left</p>
          <div
            className={`gate-clock${remaining !== null && remaining < 300 ? ' low' : ''}`}
            role="timer"
            aria-label={remaining === null ? 'Time left' : `Time left ${clock(remaining)}`}
          >
            {[
              ['Hours', remaining === null ? null : Math.floor(remaining / 3600)],
              ['Minutes', remaining === null ? null : Math.floor((remaining % 3600) / 60)],
              ['Seconds', remaining === null ? null : remaining % 60],
            ].map(([unit, value], i) => (
              <div className="gate-clock-part" key={unit as string}>
                {i > 0 && <span className="gate-clock-sep">:</span>}
                <div className="wr-tile">
                  <span className="wr-digits">
                    {value === null ? '--' : String(value).padStart(2, '0')}
                  </span>
                  <span className="wr-unit">{unit}</span>
                </div>
              </div>
            ))}
          </div>
          {late !== null && (
            <p className="gs-late">
              <Icon name="info" size={16} />
              <span>
                The full time is {attempt.exam.durationMinutes} minutes, but the exam closes at{' '}
                {new Date(attempt.deadlineAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                , so this is all the time you have left.
              </span>
            </p>
          )}

          <div className="gate-info">
            <div className="gate-info-card">
              <h3>Exam details</h3>
              <dl>
                <div>
                  <dt>Questions</dt>
                  <dd>{nQ}</dd>
                </div>
                <div>
                  <dt>Total marks</dt>
                  <dd>{attempt.exam.totalMarks}</dd>
                </div>
                <div>
                  <dt>Pass mark</dt>
                  <dd>{attempt.exam.passPercent}%</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{attempt.exam.durationMinutes} min</dd>
                </div>
                {attempt.exam.endsAt && (
                  <div>
                    <dt>Closes at</dt>
                    <dd>
                      {new Date(attempt.exam.endsAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </dd>
                  </div>
                )}
                {attempt.exam.code && (
                  <div>
                    <dt>Exam code</dt>
                    <dd>{attempt.exam.code}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="gate-info-card">
              <h3>Candidate</h3>
              <div className="gate-student">
                <span className="gate-avatar" aria-hidden="true">
                  {attempt.student.name.trim().charAt(0).toUpperCase() || 'S'}
                </span>
                <div>
                  <b>{attempt.student.name}</b>
                  <span>{attempt.student.email}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="gate-side">
          {attempt.exam.instructions && (
            <div className="wr-panel">
              <h3>Instructions from your trainer</h3>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{attempt.exam.instructions}</p>
            </div>
          )}
          <div className="wr-panel">
            <h3>Before you begin</h3>
            <ul className="gs-rules">
              <li>
                <span className="gs-ico">
                  <Icon name="panel" size={18} />
                </span>
                <p>The exam runs full screen. Copy, paste and right-click are disabled.</p>
              </li>
              {attempt.strikePolicy === 'AUTO_SUBMIT' && (
                <li>
                  <span className="gs-ico warn">
                    <Icon name="alert" size={18} />
                  </span>
                  <p>
                    Leaving the screen, switching tabs or windows counts as a warning.{' '}
                    <b>{attempt.maxStrikes} warnings</b> submit your exam automatically. You have{' '}
                    {warnings} so far.
                  </p>
                </li>
              )}
              {attempt.strikePolicy === 'WARN' && (
                <li>
                  <span className="gs-ico warn">
                    <Icon name="alert" size={18} />
                  </span>
                  <p>
                    Leaving the screen or switching tabs gives you a warning and your trainer sees
                    the count, but it will not submit your exam. You have {warnings} so far.
                  </p>
                </li>
              )}
              {attempt.strikePolicy === 'OFF' && (
                <li>
                  <span className="gs-ico">
                    <Icon name="eye" size={18} />
                  </span>
                  <p>
                    Your trainer is told if you leave the exam screen or switch tabs. Nothing is
                    submitted for you.
                  </p>
                </li>
              )}
              <li>
                <span className="gs-ico">
                  <Icon name="zap" size={18} />
                </span>
                <p>Very short interruptions, like a notification, are ignored.</p>
              </li>
              <li>
                <span className="gs-ico ok">
                  <Icon name="check" size={18} />
                </span>
                <p>Every answer is saved as you go.</p>
              </li>
            </ul>
            <Button onClick={begin}>{nQ ? 'Begin exam' : 'Continue'}</Button>
          </div>
        </aside>
      </main>
    );
  }

  const q = attempt.questions[current];
  const isLast = current === attempt.questions.length - 1;
  const a = answers[q.id] ?? blank();
  const answeredCount = attempt.questions.filter((x) => isAnswered(answers[x.id])).length;
  const progressPercent = Math.round((answeredCount / attempt.questions.length) * 100);

  return (
    <main className="attempt-page" style={{ userSelect: 'none' }}>
      <div className="sr-only" role="status" aria-live="assertive">
        {announce}
      </div>
      <header className="attempt-topbar">
        <div className="attempt-title">
          <span className="attempt-title-dot" />
          <span>{attempt.exam.title}</span>
          <span className="attempt-crumb">
            Question {q.number} of {attempt.questions.length}
          </span>
        </div>
        <div className="attempt-stats">
          <span className="save-pill" role="status" aria-live="polite">
            <span
              className={`save-dot ${saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : ''}`}
            />
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'error'
                ? 'Offline, retrying…'
                : 'All saved'}
          </span>
          {attempt.strikePolicy !== 'OFF' && (
            <span className={`badge ${attempt.strikes > 0 ? 'badge-warn' : ''}`}>
              <Icon name="shield" size={14} />
              <span>
                Warnings {attempt.strikes}
                {attempt.strikePolicy === 'AUTO_SUBMIT' ? `/${attempt.maxStrikes}` : ''}
              </span>
            </span>
          )}
          <span
            className={`timer-chip ${remaining !== null && remaining < 300 ? 'timer-warn' : ''}`}
            role="timer"
            aria-live="off"
            aria-label={remaining === null ? 'Time left' : `Time left ${clock(remaining)}`}
          >
            <Icon name="clock" size={16} />
            <span>{remaining === null ? '--:--' : clock(remaining)}</span>
          </span>
        </div>
      </header>

      {warning && (
        <Alert>
          {warning}{' '}
          <button className="btn btn-secondary btn-small" onClick={() => setWarning('')}>
            OK
          </button>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {!fullscreen && (
        <Alert>
          You left full screen.{' '}
          <Button
            small
            onClick={() => document.documentElement.requestFullscreen().catch(() => undefined)}
          >
            Return to full screen
          </Button>
        </Alert>
      )}

      <div className={`attempt-grid${navMode === 'full' ? '' : ` nav-${navMode}`}`}>
        <section className="card attempt-main">
          <div className="toolbar attempt-q-head">
            <div className="q-head-main">
              <span className="q-head-num">{q.number}</span>
              <div>
                <strong>
                  Question {q.number} of {attempt.questions.length}
                </strong>
                <span className="q-head-meta">
                  {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                  {q.type === 'MULTI' ? ' · Select all that apply' : ''}
                </span>
              </div>
            </div>
            <span className="spacer" />
            {navMode === 'hidden' && (
              <button
                type="button"
                className="nav-reopen"
                onClick={() => setNavMode('full')}
                aria-label="Show question navigator"
              >
                <Icon name="panel" size={16} />
                <span>
                  Questions {answeredCount}/{attempt.questions.length}
                </span>
              </button>
            )}
            <Button
              variant={a.flagged ? 'primary' : 'secondary'}
              small
              onClick={() => change(q.id, { flagged: !a.flagged })}
            >
              {a.flagged ? 'Flagged for review' : 'Flag for review'}
            </Button>
          </div>

          <div className="attempt-scroll">
            <div
              className="q-body"
              style={{
                whiteSpace: 'pre-wrap',
                margin: '18px 0 20px',
                fontSize: '1rem',
                lineHeight: 1.6,
              }}
            >
              <QuestionText text={q.body} markdown={q.markdown} />
              {q.imageAlt && (
                <QuestionImage
                  path={`/attempts/${attempt.id}/questions/${q.id}/image`}
                  alt={q.imageAlt}
                />
              )}
            </div>

            {q.type === 'SUBJECTIVE' ? (
              <div className="field">
                <textarea
                  value={a.text}
                  onChange={(e) => change(q.id, { text: e.target.value })}
                  placeholder="Type your response here..."
                  className="answer-area"
                  maxLength={50_000}
                />
              </div>
            ) : (
              <div className="stack" style={{ marginTop: 12 }}>
                {q.options.map((o, i) => {
                  const checked = a.selected.includes(o.id);
                  return (
                    <label className={`attempt-opt-card${checked ? ' selected' : ''}`} key={o.id}>
                      <input
                        type={q.type === 'SINGLE' ? 'radio' : 'checkbox'}
                        name={q.id}
                        checked={checked}
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                        onChange={() =>
                          change(q.id, {
                            selected:
                              q.type === 'SINGLE'
                                ? [o.id]
                                : checked
                                  ? a.selected.filter((x) => x !== o.id)
                                  : [...a.selected, o.id],
                          })
                        }
                      />
                      <span className="opt-badge">{String.fromCharCode(65 + i)}</span>
                      <span style={{ flex: 1, paddingTop: 2 }}>
                        <QuestionText text={o.text} markdown={q.markdown} />
                      </span>
                    </label>
                  );
                })}
                {a.selected.length > 0 && q.type === 'SINGLE' && (
                  <div>
                    <Button
                      variant="secondary"
                      small
                      onClick={() => change(q.id, { selected: [] })}
                    >
                      Clear answer
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="toolbar attempt-actions">
            <Button
              variant="secondary"
              disabled={current === 0}
              onClick={() => setCurrent((c) => c - 1)}
            >
              Previous
            </Button>
            <span className="spacer" />
            {isLast ? (
              <Button onClick={() => setConfirmSubmit(true)}>Submit exam</Button>
            ) : (
              <Button onClick={() => setCurrent((c) => c + 1)}>Next</Button>
            )}
          </div>
        </section>

        <aside
          className={`card attempt-nav${navOpen ? ' open' : ''}`}
          id="question-navigator"
          aria-label="Question navigator"
        >
          <div className="nav-head">
            <h2 className="nav-title">Question navigator</h2>
            <div className="nav-tools">
              <button
                type="button"
                className="nav-toggle"
                onClick={() => setNavMode(navMode === 'slim' ? 'full' : 'slim')}
                aria-label={
                  navMode === 'slim'
                    ? 'Expand question navigator'
                    : 'Make question navigator smaller'
                }
                title={navMode === 'slim' ? 'Expand' : 'Make smaller'}
              >
                <Icon name="panel" size={18} />
              </button>
              <button
                type="button"
                className="nav-toggle nav-hide"
                onClick={() => setNavMode('hidden')}
                aria-label="Hide question navigator"
                title="Hide"
              >
                <Icon name="chevron" size={18} />
              </button>
            </div>
          </div>
          <span className="nav-count" aria-hidden="true">
            {answeredCount}/{attempt.questions.length}
          </span>
          <div className="nav-progress">
            <div className="nav-progress-top">
              <span>
                {answeredCount} of {attempt.questions.length} answered
              </span>
              <b>{progressPercent}%</b>
            </div>
            <div className="q-progress">
              <div className="q-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div
            className="q-nav-grid"
            ref={navRef}
            onKeyDown={(e) => {
              const keys: Record<string, number> = {
                ArrowRight: 1,
                ArrowDown: 5,
                ArrowLeft: -1,
                ArrowUp: -5,
              };
              const total = attempt.questions.length;
              let next = -1;
              if (e.key in keys) next = Math.min(total - 1, Math.max(0, current + keys[e.key]));
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = total - 1;
              if (next < 0) return;
              e.preventDefault();
              setCurrent(next);
              navRef.current?.querySelectorAll<HTMLElement>('button')[next]?.focus();
            }}
          >
            {attempt.questions.map((x, i) => {
              const ans = answers[x.id];
              const done = isAnswered(ans);
              const isCurrent = i === current;
              const isFlagged = Boolean(ans?.flagged);
              return (
                <button
                  key={x.id}
                  className={`q-nav-tile${done ? ' answered' : ''}${isCurrent ? ' current' : ''}${isFlagged ? ' flagged' : ''}`}
                  aria-label={`Question ${x.number}${done ? ', answered' : ''}${isFlagged ? ', flagged' : ''}`}
                  aria-current={isCurrent}
                  tabIndex={isCurrent ? 0 : -1}
                  onClick={() => {
                    setCurrent(i);
                    setNavOpen(false);
                  }}
                >
                  {x.number}
                </button>
              );
            })}
          </div>

          <div className="nav-legend">
            <div>
              <i className="lg-answered" />
              <span>Answered</span>
              <b>{answeredCount}</b>
            </div>
            <div>
              <i className="lg-flagged" />
              <span>Flagged for review</span>
              <b>{attempt.questions.filter((x) => answers[x.id]?.flagged).length}</b>
            </div>
            <div>
              <i className="lg-open" />
              <span>Not answered</span>
              <b>{attempt.questions.length - answeredCount}</b>
            </div>
          </div>
        </aside>
      </div>

      <div className="attempt-mobilebar">
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={navOpen}
          aria-controls="question-navigator"
          onClick={() => setNavOpen((o) => !o)}
        >
          Questions {answeredCount}/{attempt.questions.length}
        </button>
        {isLast ? (
          <button type="button" className="btn btn-primary" onClick={() => setConfirmSubmit(true)}>
            Submit exam
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCurrent((c) => c + 1);
              setNavOpen(false);
            }}
          >
            Next
          </button>
        )}
      </div>

      {confirmSubmit && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-title"
        >
          <div className="modal-card" ref={modalRef}>
            <h2 id="submit-title" style={{ marginTop: 0, fontSize: '1.25rem' }}>
              Submit your exam?
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '0.94rem', lineHeight: 1.55 }}>
              You have answered{' '}
              <strong>
                {answeredCount} of {attempt.questions.length}
              </strong>{' '}
              questions
              {attempt.questions.some((x) => answers[x.id]?.flagged)
                ? ' and some questions are flagged for review'
                : ''}
              . You cannot change your answers after submitting.
            </p>
            <div className="toolbar" style={{ marginTop: 20 }}>
              <Button loading={submitting} onClick={() => void submit()}>
                Yes, submit exam
              </Button>
              <Button variant="secondary" onClick={() => setConfirmSubmit(false)}>
                Keep working
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
