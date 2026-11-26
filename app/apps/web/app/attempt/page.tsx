'use client';

import Link from 'next/link';
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
import { ApiError, api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { AttemptEnded } from '../../components/attempt/ended-screen';
import { AttemptTopBar } from '../../components/attempt/top-bar';
import { QuestionPanel } from '../../components/attempt/question-panel';
import { QuestionNavigator } from '../../components/attempt/navigator';
import { MobileBar } from '../../components/attempt/mobile-bar';
import { SubmitDialog } from '../../components/attempt/submit-dialog';
import {
  TIMING_POLL_MS,
  TIMING_RECHECK_MS,
  blank,
  isAnswered,
  type SaveState,
} from '../../components/attempt/helpers';

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
  // There is no separate start screen: an open exam goes straight to the questions.
  const begun = live;
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
    // Phones without full screen (iOS Safari) blur the window for the notification shade or the
    // keyboard bar. Leaving the app still shows up as a hidden tab, so only that is counted there.
    const noFullscreen = typeof document.documentElement.requestFullscreen !== 'function';
    const onBlur = () => (noFullscreen ? undefined : away('WINDOW_BLUR'));
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

  // Browsers only allow full screen after a click or key press, so ask on the first one.
  useEffect(() => {
    if (!live) return;
    if (typeof document.documentElement.requestFullscreen !== 'function') {
      // iOS Safari and some tablets have no full screen. Note it for the trainer, never penalise.
      void report('FULLSCREEN_UNSUPPORTED');
      return;
    }
    const enter = () => {
      if (document.fullscreenElement) return;
      try {
        void document.documentElement.requestFullscreen()?.catch(() => undefined);
      } catch {
        // Refused: the exam proceeds without it.
      }
    };
    document.addEventListener('pointerdown', enter, { once: true });
    document.addEventListener('keydown', enter, { once: true });
    return () => {
      document.removeEventListener('pointerdown', enter);
      document.removeEventListener('keydown', enter);
    };
  }, [live, report]);

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

  if (!live) return <AttemptEnded attempt={attempt} />;

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
      <AttemptTopBar
        attempt={attempt}
        number={q.number}
        saveState={saveState}
        remaining={remaining}
      />

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
        <QuestionPanel
          attempt={attempt}
          q={q}
          a={a}
          isLast={isLast}
          current={current}
          answeredCount={answeredCount}
          navMode={navMode}
          setNavMode={setNavMode}
          change={change}
          setCurrent={setCurrent}
          setConfirmSubmit={setConfirmSubmit}
        />
        <QuestionNavigator
          attempt={attempt}
          answers={answers}
          current={current}
          navMode={navMode}
          navOpen={navOpen}
          answeredCount={answeredCount}
          progressPercent={progressPercent}
          navRef={navRef}
          setNavMode={setNavMode}
          setCurrent={setCurrent}
          setNavOpen={setNavOpen}
        />
      </div>

      <MobileBar
        attempt={attempt}
        answeredCount={answeredCount}
        isLast={isLast}
        navOpen={navOpen}
        setNavOpen={setNavOpen}
        setCurrent={setCurrent}
        setConfirmSubmit={setConfirmSubmit}
      />

      {confirmSubmit && (
        <SubmitDialog
          attempt={attempt}
          answers={answers}
          answeredCount={answeredCount}
          submitting={submitting}
          modalRef={modalRef}
          submit={submit}
          setConfirmSubmit={setConfirmSubmit}
        />
      )}
    </main>
  );
}
