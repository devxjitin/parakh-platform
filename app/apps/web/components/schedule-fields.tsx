'use client';

import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';

export interface StartValue {
  date: string;
  time: string;
}

export interface StartErrors {
  date?: string;
  time?: string;
}

/** ISO string -> separate date and time values in the viewer's time zone. */
export function toStartValue(iso: string | null | undefined): StartValue {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Checks the start date and time together. Returns the ISO start (or null when both are blank and
 * `required` is false) and any errors to show next to the fields.
 */
export function checkStart(
  v: StartValue,
  opts: { required: boolean; durationMinutes?: number },
): { iso: string | null; errors: StartErrors } {
  const errors: StartErrors = {};
  if (!v.date && !v.time) {
    if (opts.required) errors.date = 'Choose when the exam starts';
    return { iso: null, errors };
  }
  if (!v.date) errors.date = 'Choose the start date';
  if (!v.time) errors.time = 'Choose the start time';
  if (errors.date || errors.time) return { iso: null, errors };
  const d = new Date(`${v.date}T${v.time}`);
  if (Number.isNaN(d.getTime())) return { iso: null, errors: { date: 'Enter a valid start date' } };
  // The start is checked again when the exam is published, but say so here as early as possible.
  if (opts.required && d.getTime() <= Date.now()) {
    return { iso: null, errors: { date: 'Choose a start time in the future' } };
  }
  return { iso: d.toISOString(), errors };
}

/**
 * The optional closing time. Left blank, the exam closes when its time is up (start plus
 * duration). A later closing time keeps it open for students to join until then: each student's
 * own time still runs from when they start, and is cut short only by the closing time.
 */
export function checkClosing(
  v: StartValue,
  startIso: string | null,
  durationMinutes: number | undefined,
): { iso: string | null; errors: StartErrors } {
  if (!v.date && !v.time) return { iso: null, errors: {} };
  const errors: StartErrors = {};
  if (!v.date) errors.date = 'Choose the closing date';
  if (!v.time) errors.time = 'Choose the closing time';
  if (errors.date || errors.time) return { iso: null, errors };
  const d = new Date(`${v.date}T${v.time}`);
  if (Number.isNaN(d.getTime())) {
    return { iso: null, errors: { date: 'Enter a valid closing date' } };
  }
  if (startIso && durationMinutes) {
    const earliest = new Date(startIso).getTime() + durationMinutes * 60_000;
    if (d.getTime() < earliest) {
      return {
        iso: null,
        errors: {
          date: `Closing time must be at least ${durationMinutes} minutes after the start, so the full exam fits`,
        },
      };
    }
  }
  return { iso: d.toISOString(), errors };
}

/** Start date and time, plus an optional closing date and time. Controlled by the parent. */
export function ScheduleFields({
  value,
  onChange,
  errors,
  closing,
  onClosingChange,
  closingErrors,
  durationMinutes,
}: {
  value: StartValue;
  onChange: (next: StartValue) => void;
  errors: StartErrors;
  closing: StartValue;
  onClosingChange: (next: StartValue) => void;
  closingErrors: StartErrors;
  durationMinutes?: number;
}) {
  return (
    <section className="form-section form-full">
      <h3>Schedule</h3>
      <p className="card-sub">
        Choose when the exam starts. The start time must still be in the future when you publish.
      </p>
      <div className="field-row field-row-2">
        <DatePicker
          label="Start date"
          required
          name="startsDate"
          value={value.date}
          onChange={(date) => onChange({ ...value, date })}
          error={errors.date}
        />
        <TimePicker
          label="Start time"
          required
          name="startsTime"
          defaultValue={value.time}
          error={errors.time}
          onChange={(time) => onChange({ ...value, time })}
        />
      </div>
      <p className="card-sub" style={{ marginTop: 18 }}>
        Closing time (optional). Leave it empty and the exam closes when its time is up
        {durationMinutes ? ` (${durationMinutes} minutes after the start)` : ''}. Set a later
        closing time to let students join any time until then. Each student still gets the full
        duration from when they start, but never past the closing time.
      </p>
      <div className="field-row field-row-2">
        <DatePicker
          label="Closing date"
          name="endsDate"
          value={closing.date}
          onChange={(date) => onClosingChange({ ...closing, date })}
          error={closingErrors.date}
        />
        <TimePicker
          label="Closing time"
          name="endsTime"
          defaultValue={closing.time}
          error={closingErrors.time}
          onChange={(time) => onClosingChange({ ...closing, time })}
        />
      </div>
    </section>
  );
}
