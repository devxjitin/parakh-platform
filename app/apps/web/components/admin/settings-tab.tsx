'use client';

import { useEffect, useState } from 'react';
import type { PlatformSettings } from '@parakh/shared';
import { Alert, Button, describeError } from '../ui';
import { api } from '../../lib/api';
import { confirmDialog } from '../dialogs';
import { rupees } from './format';

export function Settings() {
  const [form, setForm] = useState<Record<keyof PlatformSettings, string> | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const toForm = (s: PlatformSettings) => ({
    examCreationPaise: String(s.examCreationPaise / 100),
    examJoinPaise: String(s.examJoinPaise / 100),
    examinerSharePercent: String(s.examinerSharePercent),
    minPayoutPaise: String(s.minPayoutPaise / 100),
  });
  useEffect(() => {
    api<PlatformSettings>('/admin/settings')
      .then((s) => setForm(toForm(s)))
      .catch((e) => setError(describeError(e).message));
  }, []);

  if (!form) return error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>;

  const field = (key: keyof PlatformSettings, label: string, hint: string, unit: string) => (
    <label className="field">
      <span>
        {label} ({unit})
      </span>
      <input
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      <small className="muted">{hint}</small>
    </label>
  );

  async function save() {
    if (!form) return;
    const rupeesToPaise = (v: string) => Math.round(Number(v) * 100);
    const body: PlatformSettings = {
      examCreationPaise: rupeesToPaise(form.examCreationPaise),
      examJoinPaise: rupeesToPaise(form.examJoinPaise),
      examinerSharePercent: Number(form.examinerSharePercent),
      minPayoutPaise: rupeesToPaise(form.minPayoutPaise),
    };
    if (Object.values(body).some((v) => !Number.isFinite(v))) {
      setError('Enter numbers only.');
      return;
    }
    if (
      !(await confirmDialog(
        `Publishing fee ${rupees(body.examCreationPaise)}, join fee ${rupees(body.examJoinPaise)}.\n\nThis applies to payments made from now on. Save?`,
        { title: 'Change platform fees', confirmLabel: 'Save' },
      ))
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    try {
      setForm(toForm(await api<PlatformSettings>('/admin/settings', { method: 'PUT', body })));
      setNote('Saved. New payments use these values.');
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Prices</h2>
      <p className="muted">
        Changes apply to payments made from now on. Past payments keep what was charged, and the
        ledger is never rewritten. Every change is recorded in the audit log.
      </p>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {field('examCreationPaise', 'Publishing fee', 'Trainers pay this to publish an exam.', '₹')}
      {field('examJoinPaise', 'Join fee', 'Students pay this to join an exam.', '₹')}
      <Button loading={busy} onClick={save}>
        Save settings
      </Button>
    </section>
  );
}
