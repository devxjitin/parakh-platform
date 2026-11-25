'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PRICING,
  createExamSchema,
  updateExamSchema,
  type CategoryDto,
  type ExamDetailDto,
} from '@parakh/shared';
import { Alert, Button, Field, FieldErrors, Req, describeError, validate } from './ui';
import { ApiError, api } from '../lib/api';
import { useStepSave, type RegisterSave } from '../lib/step-save';

/** The value of the category dropdown that means "add a new category". */
const NEW_CATEGORY = '__new__';

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
  /** NandiVex-run exams only: always open, and how it appears on the public list. */
  alwaysOpen?: boolean;
  catalogSummary?: string | null;
  catalogTopics?: string[];
  catalogCategory?: string;
}

export function ExamSettingsForm({
  initial,
  nandivex = false,
  alwaysOpenMode = false,
  submitLabel,
  onSubmit,
  registerSave,
}: {
  initial?: ExamDetailDto;
  /** The exam is run by NandiVex (an admin is creating it): show the student fee. */
  nandivex?: boolean;
  /** Creating an always-open exam (admin): no schedule, and it can be listed publicly. */
  alwaysOpenMode?: boolean;
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
  // An always-open exam has no schedule and a public listing; a scheduled one has neither.
  const alwaysOpen = initial ? initial.alwaysOpen : alwaysOpenMode;
  // The categories an admin has created, and what is chosen in the dropdown.
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState(initial?.catalogCategory ?? '');
  useEffect(() => {
    if (!alwaysOpen) return;
    api<CategoryDto[]>('/admin/categories')
      .then((rows) => setCategories(rows))
      .catch(() => setCategories([]))
      .finally(() => setCategoriesLoaded(true));
  }, [alwaysOpen]);

  /** The category the admin picked, or the new name they typed under "Other". */
  function categoryFrom(f: FormData): string {
    const choice = String(f.get('catalogCategory') ?? '');
    return choice === NEW_CATEGORY ? String(f.get('catalogCategoryNew') ?? '').trim() : choice;
  }

  /** Creates the typed category (when "Other" is chosen) so the exam can be filed under it. */
  async function ensureCategory(form: HTMLFormElement | null, name: unknown) {
    if (!form || !alwaysOpen || typeof name !== 'string') return;
    if (String(new FormData(form).get('catalogCategory') ?? '') !== NEW_CATEGORY) return;
    try {
      const row = await api<CategoryDto>('/admin/categories', { method: 'POST', body: { name } });
      setCategories((c) => [...c, row].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      // It already exists: the API matches names ignoring case, so the exam can use it as is.
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    setCategoryChoice(name);
  }

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
        ? {
            studentFeePaise: Math.round(Number(f.get('studentFee') ?? 0) * 100),
            // The type is chosen when the exam is created and cannot change afterwards.
            ...(initial ? {} : { alwaysOpen: alwaysOpenMode }),
            ...(alwaysOpen
              ? {
                  catalogSummary: String(f.get('catalogSummary') ?? '').trim() || null,
                  catalogCategory: categoryFrom(f),
                  catalogTopics: String(f.get('catalogTopics') ?? '')
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                }
              : {}),
          }
        : {}),
    };
    const result = validate(initial ? updateExamFormSchema : createExamSchema, candidate);
    if (!alwaysOpen) return result;
    // The exam list card needs its summary and topics (the update schema is partial, so check here).
    const c = candidate as { catalogSummary?: string | null; catalogTopics?: string[] };
    const extra: FieldErrors = {};
    if (!c.catalogSummary) {
      extra.catalogSummary = 'Write a short summary students will see in the exam list';
    }
    if (!c.catalogTopics?.length) extra.catalogTopics = 'Add at least one topic';
    const choice = String(new FormData(form).get('catalogCategory') ?? '');
    if (!choice) extra.catalogCategory = 'Choose the category this exam belongs to';
    else if (choice === NEW_CATEGORY && !categoryFrom(new FormData(form))) {
      extra.catalogCategoryNew = 'Enter the name of the new category';
    }
    if (Object.keys(extra).length === 0) return result;
    return { ok: false as const, errors: { ...(result.ok ? {} : result.errors), ...extra } };
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
      await ensureCategory(
        e.currentTarget,
        (result.data as { catalogCategory?: string }).catalogCategory,
      );
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
      await ensureCategory(form, (result.data as { catalogCategory?: string }).catalogCategory);
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
        {alwaysOpen && (
          <>
            <label className="field">
              <span>
                Summary for the exam list
                <Req />
              </span>
              <textarea
                name="catalogSummary"
                defaultValue={initial?.catalogSummary ?? ''}
                maxLength={300}
                placeholder="One or two lines that tell students what this exam is for"
              />
              {errors.catalogSummary && (
                <small className="error-text">{errors.catalogSummary}</small>
              )}
            </label>
            <label className="field">
              <span>
                Category (field)
                <Req />
              </span>
              <select
                name="catalogCategory"
                value={categoryChoice}
                onChange={(ev) => setCategoryChoice(ev.target.value)}
              >
                <option value="">{categoriesLoaded ? 'Choose a category' : 'Loading…'}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>Other (add a new category)</option>
              </select>
              <small className="muted">
                Students can filter the exam list by this field. Not in the list? Choose Other.
              </small>
              {errors.catalogCategory && (
                <small className="error-text">{errors.catalogCategory}</small>
              )}
            </label>
            {categoryChoice === NEW_CATEGORY && (
              <Field
                label="Category Name"
                required
                name="catalogCategoryNew"
                maxLength={40}
                placeholder="For example: Cyber Security"
                error={errors.catalogCategoryNew}
              />
            )}
            <Field
              label="Topics (comma separated)"
              required
              name="catalogTopics"
              defaultValue={initial?.catalogTopics.join(', ') ?? ''}
              hint="For example: RAG, Agents, Prompting. Shown on the exam card. This exam is listed on the landing page and in the app as soon as you publish it."
              error={errors.catalogTopics}
            />
          </>
        )}
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
