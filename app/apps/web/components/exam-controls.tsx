'use client';

import { useState } from 'react';
import type { CancelExamResultDto, CloseExamResultDto, ExamDetailDto } from '@parakh/shared';
import { api } from '../lib/api';
import { Alert, Button, describeError } from './ui';
import { confirmDialog, promptDialog } from './dialogs';

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

  if (exam.status === 'CANCELLED') {
    return <Alert>This exam was cancelled. Students who had not started were refunded.</Alert>;
  }
  if (exam.status !== 'PUBLISHED') return null;
  const closed = exam.endsAt !== null && new Date(exam.endsAt).getTime() <= Date.now();

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
        'Close the exam now? Nobody new can start. Students already sitting it keep their own time.',
        { title: 'Close exam now', confirmLabel: 'Close now', danger: true },
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

  async function cancel() {
    const reason = await promptDialog(
      'Cancel this exam? Nobody can join or start it any more. Fees are not refundable, so ' +
        'students who already paid are NOT refunded. They are emailed about the cancellation.',
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
        return `Cancelled. ${r.students} paid student(s) are not refunded.`;
      } catch (err) {
        const message = describeError(err).message;
        if (/already started/i.test(message)) {
          const anyway = await confirmDialog(`${message}\n\nCancel anyway? Nobody is refunded.`, {
            title: 'Cancel anyway?',
            confirmLabel: 'Cancel anyway',
            danger: true,
          });
          if (!anyway) return 'Not cancelled.';
          const r = await api<CancelExamResultDto>(`/exams/${exam.id}/cancel`, {
            method: 'POST',
            body: { reason: reason.trim(), force: true },
          });
          return `Cancelled. ${r.students} paid student(s) are not refunded.`;
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
      <div className="toolbar">
        {!closed && (
          <Button variant="secondary" loading={busy === 'close'} onClick={close}>
            Close now
          </Button>
        )}
        <Button variant="danger" loading={busy === 'cancel'} onClick={cancel}>
          Cancel exam
        </Button>
      </div>
    </section>
  );
}
