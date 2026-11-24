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
  if (
    opts.required &&
    opts.durationMinutes &&
    d.getTime() + opts.durationMinutes * 60_000 <= Date.now()
  ) {
    return { iso: null, errors: { date: 'The exam would already be over at this time' } };
  }
  return { iso: d.toISOString(), errors };
}

/** Start date + clock-face start time, side by side. Controlled by the parent. */
export function ScheduleFields({
  value,
  onChange,
  errors,
  endsAt,
}: {
  value: StartValue;
  onChange: (next: StartValue) => void;
  errors: StartErrors;
  endsAt?: string | null;
}) {
  return (
    <section className="form-section form-full">
      <h3>Schedule</h3>
      <p className="card-sub">
        Choose when the exam starts. It closes by itself when its time is up: the start time plus
        the duration from the Basics step.
        {endsAt && <> It currently closes at {new Date(endsAt).toLocaleString()}.</>}
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
    </section>
  );
}
