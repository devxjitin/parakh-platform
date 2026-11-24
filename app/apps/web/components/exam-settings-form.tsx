'use client';

import { useEffect, useRef, useState } from 'react';
import { PRICING, createExamSchema, updateExamSchema, type ExamDetailDto } from '@parakh/shared';
import { Alert, Button, Field, FieldErrors, describeError, validate } from './ui';
import { useStepSave, type RegisterSave } from '../lib/step-save';

/** Blank number inputs become NaN so the schema reports them instead of treating them as 0. */
const toNumber = (v: FormDataEntryValue | null): number =>
  v === null || String(v).trim() === '' ? Number.NaN : Number(v);

// Editing an existing exam keeps the original rules (no "already in the past" check on a
// running or finished exam); every setting is still required in the form.
const updateExamFormSchema = updateExamSchema;

export interface ExamSettingsValues {
  title: string;
  description: string | null;
  instructions: string | null;
  durationMinutes: number;
  // The start date and time are chosen in the Paper plan step.
  passPercent: number;
  // Shuffling is chosen in the Publish step (the API defaults both to on for a new exam).
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  // The exam policy (strikes) is chosen in the Publish step's Security section.
  strikePolicy?: 'OFF' | 'WARN' | 'AUTO_SUBMIT';
  maxStrikes?: number;
  certificatesEnabled?: boolean;
  /** NandiVex-run exams only: what a student pays, in paise (0 = free). */
  studentFeePaise?: number;
}

export function ExamSettingsForm({
  initial,
  nandivex = false,
  submitLabel,
  onSubmit,
  registerSave,
}: {
  initial?: ExamDetailDto;
  /** The exam is run by NandiVex (an admin is creating it): show the student fee. */
  nandivex?: boolean;
  submitLabel: string;
  onSubmit: (values: ExamSettingsValues) => Promise<void>;
  /**
   * No button: the page saves this form when the trainer presses Next (see `useStepSave`).
   */
  registerSave?: RegisterSave;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Reads the form and checks it against the schema. */
  function read(form: HTMLFormElement) {
    const f = new FormData(form);
    const candidate = {
      title: String(f.get('title') ?? ''),
      description: String(f.get('description') ?? '') || null,
      instructions: String(f.get('instructions') ?? '') || null,
      durationMinutes: toNumber(f.get('durationMinutes')),
      passPercent: toNumber(f.get('passPercent')),
      ...(nandivex || initial?.nandivexHosted
        ? { studentFeePaise: Math.round(Number(f.get('studentFee') ?? 0) * 100) }
        : {}),
    };
    return validate(initial ? updateExamFormSchema : createExamSchema, candidate);
  }

  /** Certificates are switched on or off later, in the exam's Certificate tab. */
  function valuesOf(data: unknown): ExamSettingsValues {
    const { certificatesEnabled: _ignored, ...rest } = data as ExamSettingsValues;
    return rest as ExamSettingsValues;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (registerSave) return;
    const result = read(e.currentTarget);
    setSaved(false);
    if (!result.ok) {
      const errs = result.errors;
      setErrors(errs);
      setMessage('Please fix the highlighted fields.');
      const first = Object.keys(errs)[0];
      if (first) e.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    setMessage('');
    setBusy(true);
    try {
      await onSubmit(valuesOf(result.data));
      setSaved(true);
    } catch (err) {
      const d = describeError(err);
      setMessage(d.message);
      setErrors(d.fields);
    } finally {
      setBusy(false);
    }
  }

  // ---- saved when the trainer presses Next (edit page) ----
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!registerSave || !formRef.current) return;
    const first = read(formRef.current);
    lastSaved.current = first.ok ? JSON.stringify(first.data) : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerSave]);

  useStepSave(registerSave, async () => {
    const form = formRef.current;
    if (!form) return null;
    const result = read(form);
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return 'Please fix the highlighted fields.';
    }
    const key = JSON.stringify(result.data);
    if (key === lastSaved.current) return null;
    try {
      await onSubmit(valuesOf(result.data));
      lastSaved.current = key;
      setErrors({});
      return null;
    } catch (err) {
      const d = describeError(err);
      setErrors(d.fields);
      return d.message;
    }
  });

  return (
    <form
      ref={formRef}
      className="form-layout"
      onSubmit={submit}
      onChange={(e) => {
        const name = (e.target as unknown as HTMLInputElement).name;
        if (name && errors[name]) setErrors(({ [name]: _gone, ...rest }) => rest);
      }}
      noValidate
    >
      {!registerSave && (message || saved) && (
        <div className="form-full">
          {message && <Alert>{message}</Alert>}
          {saved && <Alert kind="success">Saved.</Alert>}
        </div>
      )}

      <section className="form-section form-full">
        <h3>Basics</h3>
        <p className="card-sub">What students see before and during the exam.</p>
        <Field
          label="Exam title"
          required
          name="title"
          defaultValue={initial?.title}
          error={errors.title}
          maxLength={150}
        />
        <div className="field-row field-row-2">
          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              defaultValue={initial?.description ?? ''}
              maxLength={2000}
              placeholder="A short summary of what this exam covers"
            />
            {errors.description && <small className="error-text">{errors.description}</small>}
          </label>
          <label className="field">
            <span>Instructions shown to students</span>
            <textarea
              name="instructions"
              defaultValue={initial?.instructions ?? ''}
              maxLength={4000}
              placeholder="Rules and tips students read before they start"
            />
            {errors.instructions && <small className="error-text">{errors.instructions}</small>}
          </label>
        </div>
      </section>

      <section className="form-section form-full">
        <h3>Limits and grading</h3>
        <p className="card-sub">How long it runs and who can sit it.</p>
        <div className="field-row field-row-3">
          <Field
            label="Duration (min)"
            required
            name="durationMinutes"
            type="number"
            min={5}
            max={360}
            defaultValue={initial?.durationMinutes ?? 60}
            error={errors.durationMinutes}
          />
          <Field
            label="Pass mark (%)"
            required
            name="passPercent"
            type="number"
            min={0}
            max={100}
            step="0.5"
            defaultValue={initial?.passPercent ?? 40}
            error={errors.passPercent}
          />
          {(nandivex || initial?.nandivexHosted) && (
            <Field
              label="Student fee (₹, 0 = free)"
              required
              name="studentFee"
              type="number"
              min={0}
              max={10000}
              step="1"
              defaultValue={(initial?.studentFeePaise ?? PRICING.EXAM_JOIN_PAISE) / 100}
              hint="What each student pays to join. NandiVex Technologies keeps all of it; there is no trainer share."
              error={errors.studentFeePaise}
            />
          )}
        </div>
      </section>

      {registerSave ? null : (
        <div className="form-full form-actions">
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
