'use client';

import { useState } from 'react';
import type {
  CancelExamResultDto,
  CloseExamResultDto,
  ExamDetailDto,
  RescheduleExamResultDto,
} from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, describeError } from './ui';
import { confirmDialog, promptDialog } from './dialogs';
import {
  ScheduleFields,
  checkClosing,
  checkStart,
  toStartValue,
  type StartErrors,
  type StartValue,
} from './schedule-fields';

/** Close early or cancel a published exam. Each action asks for confirmation. */
export function ExamControls({
  exam,
  reload,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [moving, setMoving] = useState(false);
  const [start, setStart] = useState<StartValue>(toStartValue(exam.startsAt));
  const [closing, setClosing] = useState<StartValue>(toStartValue(exam.endsAt));
  const [startErrors, setStartErrors] = useState<StartErrors>({});
  const [closingErrors, setClosingErrors] = useState<StartErrors>({});

  if (exam.status === 'CANCELLED') {
    return (
      <Alert>
        This exam was cancelled. Students who had not started were refunded automatically.
      </Alert>
    );
  }
  if (exam.status !== 'PUBLISHED') return null;
  const closed = exam.endsAt !== null && new Date(exam.endsAt).getTime() <= Date.now();
  const notStarted =
    !exam.alwaysOpen && exam.startsAt !== null && new Date(exam.startsAt).getTime() > Date.now();

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setError('');
    setNote('');
    try {
      setNote(await fn());
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy('');
    }
  }

  async function close() {
    if (
      !(await confirmDialog(
        exam.alwaysOpen
          ? 'Retire this exam? Nobody new can buy it and it leaves the public list. Students who already paid can still take it.'
          : 'Close the exam now? Nobody new can start. Students already sitting it keep their own time.',
        {
          title: exam.alwaysOpen ? 'Retire exam' : 'Close exam now',
          confirmLabel: exam.alwaysOpen ? 'Retire' : 'Close now',
          danger: true,
        },
      ))
    )
      return;
    await run('close', async () => {
      const r = await api<CloseExamResultDto>(`/exams/${exam.id}/close`, { method: 'POST' });
      return r.stillRunning > 0
        ? `Closed. ${r.stillRunning} student(s) are still finishing.`
        : 'Closed. No one is sitting the exam.';
    });
  }

  async function saveNewTime() {
    const s = checkStart(start, { required: true, durationMinutes: exam.durationMinutes });
    const c = checkClosing(closing, s.iso, exam.durationMinutes);
    setStartErrors(s.errors);
    setClosingErrors(c.errors);
    if (!s.iso || Object.keys(c.errors).length > 0) return;
    await run('move', async () => {
      const r = await api<RescheduleExamResultDto>(`/exams/${exam.id}/reschedule`, {
        method: 'POST',
        body: { startsAt: s.iso, endsAt: c.iso },
      });
      setMoving(false);
      return r.notified > 0
        ? `New time saved. ${r.notified} student(s) were emailed.`
        : 'New time saved.';
    });
  }

  async function cancel() {
    const reason = await promptDialog(
      'Cancel this exam? Nobody can join or start it any more. Students who paid and had not started ' +
        'are refunded automatically. Everyone is emailed about the cancellation.',
      {
        title: 'Cancel exam',
        label: 'Reason (students are told this)',
        minLength: 5,
        confirmLabel: 'Cancel exam',
        cancelLabel: 'Keep exam',
        danger: true,
      },
    );
    if (!reason) return;
    await run('cancel', async () => {
      try {
        const r = await api<CancelExamResultDto>(`/exams/${exam.id}/cancel`, {
          method: 'POST',
          body: { reason: reason.trim() },
        });
        return `Cancelled. ${r.refunding} student(s) are being refunded automatically.`;
      } catch (err) {
        const message = describeError(err).message;
        if (/already started/i.test(message)) {
          const anyway = await confirmDialog(
            `${message}\n\nCancel anyway? Students who already started are not refunded.`,
            {
              title: 'Cancel anyway?',
              confirmLabel: 'Cancel anyway',
              danger: true,
            },
          );
          if (!anyway) return 'Not cancelled.';
          const r = await api<CancelExamResultDto>(`/exams/${exam.id}/cancel`, {
            method: 'POST',
            body: { reason: reason.trim(), force: true },
          });
          return `Cancelled. ${r.refunding} student(s) are being refunded automatically.`;
        }
        throw err;
      }
    });
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Manage this exam</h2>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {moving && (
        <div style={{ marginBottom: 16 }}>
          <ScheduleFields
            value={start}
            onChange={setStart}
            errors={startErrors}
            closing={closing}
            onClosingChange={setClosing}
            closingErrors={closingErrors}
            durationMinutes={exam.durationMinutes}
          />
          <div className="toolbar">
            <Button loading={busy === 'move'} onClick={saveNewTime}>
              Save new time
            </Button>
            <Button variant="ghost" onClick={() => setMoving(false)}>
              Keep current time
            </Button>
          </div>
          <p className="card-sub">
            Students who already joined keep their seat and are emailed the new time.
          </p>
        </div>
      )}
      <div className="toolbar">
        {notStarted && !moving && (
          <Button variant="secondary" onClick={() => setMoving(true)}>
            Change time
          </Button>
        )}
        {!closed && !notStarted && (
          <Button variant="secondary" loading={busy === 'close'} onClick={close}>
            {exam.alwaysOpen ? 'Retire (stop new sales)' : 'Close now'}
          </Button>
        )}
        <Button variant="danger" loading={busy === 'cancel'} onClick={cancel}>
          Cancel exam
        </Button>
      </div>
    </section>
  );
}
