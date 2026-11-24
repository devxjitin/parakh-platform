'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { Req } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "YYYY-MM-DD" <-> local Date (no time-zone shifts). */
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => toIso(a) === toIso(b);

/** 24 Nov 2026 */
const show = (value: string) => {
  const d = fromIso(value);
  return d ? `${pad(d.getDate())} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : '';
};

/**
 * A date input with a calendar popup. The date is kept as "YYYY-MM-DD" in a hidden input named
 * `name`, so it works in a plain <form> like <input type="date">. Controlled through `value`.
 */
export function DatePicker({
  label,
  required,
  name,
  value,
  onChange,
  error,
  ariaLabel,
  min,
  placeholder = 'DD MMM YYYY',
}: {
  label?: string;
  /** Marks the field with a red asterisk. */
  required?: boolean;
  name?: string;
  /** "YYYY-MM-DD", or empty. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  ariaLabel?: string;
  /** Earlier days cannot be picked ("YYYY-MM-DD"). */
  min?: string;
  /** Shown while no date is chosen: a format hint, so it does not repeat the label. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [view, setView] = useState<'days' | 'months'>('days');
  const [shown, setShown] = useState(() => startOfDay(fromIso(value) ?? new Date()));
  const [focus, setFocus] = useState<Date>(() => startOfDay(fromIso(value) ?? new Date()));
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);

  const selected = fromIso(value);
  const today = startOfDay(new Date());
  const minDay = min ? fromIso(min) : null;
  const disabled = (d: Date) => (minDay ? d < minDay : false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The popup opens above the field. If that would run under the fixed top bar, scroll the page
  // up just enough; if the page cannot scroll that far, open below instead.
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop) return;
    const BAR = 74;
    const top = pop.getBoundingClientRect().top;
    if (up && top < BAR) {
      const need = BAR + 8 - top;
      if (window.scrollY >= need) window.scrollBy({ top: -need, behavior: 'smooth' });
      else setUp(false);
    } else if (!up) {
      pop.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [open, up]);

  // Keep keyboard focus on the focused day.
  useEffect(() => {
    if (open && view === 'days') focusRef.current?.focus({ preventScroll: true });
  }, [open, view, focus]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const start = startOfDay(selected ?? (minDay && minDay > today ? minDay : today));
    setShown(start);
    setFocus(start);
    setView('days');
    setUp(true);
    setOpen(true);
  }

  function commit(d: Date | null) {
    onChange(d ? toIso(d) : '');
    setOpen(false);
  }

  const goMonth = (delta: number) =>
    setShown((s) => new Date(s.getFullYear(), s.getMonth() + delta, 1));

  /** The six weeks shown for the month, starting on a Sunday. */
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  function onGridKey(e: React.KeyboardEvent) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next: Date | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]);
    else if (e.key === 'PageUp')
      next = new Date(focus.getFullYear(), focus.getMonth() - 1, focus.getDate());
    else if (e.key === 'PageDown')
      next = new Date(focus.getFullYear(), focus.getMonth() + 1, focus.getDate());
    else if (e.key === 'Home') next = addDays(focus, -focus.getDay());
    else if (e.key === 'End') next = addDays(focus, 6 - focus.getDay());
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    setShown(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  return (
    <div className="field time-field" ref={rootRef}>
      {label && (
        <span>
          {label}
          {required && <Req />}
        </span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        className="time-trigger"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        aria-invalid={error ? true : undefined}
      >
        <span className={show(value) ? '' : 'time-placeholder'}>{show(value) || placeholder}</span>
        <Icon name="calendar" size={18} />
      </button>
      {error && <small className="error-text">{error}</small>}

      {open && (
        <div
          ref={popRef}
          className={`cal-pop${up ? ' clock-pop-up' : ''}`}
          role="dialog"
          aria-label="Pick a date"
        >
          <div className="cal-head">
            <button
              type="button"
              className="cal-title"
              onClick={() => setView(view === 'days' ? 'months' : 'days')}
              aria-label="Choose month and year"
            >
              {view === 'days'
                ? `${MONTHS[shown.getMonth()]} ${shown.getFullYear()}`
                : shown.getFullYear()}
              <span className={`cal-title-caret${view === 'months' ? ' open' : ''}`}>
                <Icon name="chevron" size={14} />
              </span>
            </button>
            <div className="cal-nav">
              <button
                type="button"
                className="cal-arrow"
                aria-label={view === 'days' ? 'Previous month' : 'Previous year'}
                onClick={() =>
                  view === 'days'
                    ? goMonth(-1)
                    : setShown((s) => new Date(s.getFullYear() - 1, s.getMonth(), 1))
                }
              >
                <span style={{ display: 'grid', transform: 'rotate(180deg)' }}>
                  <Icon name="chevron" size={16} />
                </span>
              </button>
              <button
                type="button"
                className="cal-arrow"
                aria-label={view === 'days' ? 'Next month' : 'Next year'}
                onClick={() =>
                  view === 'days'
                    ? goMonth(1)
                    : setShown((s) => new Date(s.getFullYear() + 1, s.getMonth(), 1))
                }
              >
                <Icon name="chevron" size={16} />
              </button>
            </div>
          </div>

          {view === 'months' ? (
            <div className="cal-months" role="grid" aria-label="Months">
              {MONTHS.map((mn, i) => (
                <button
                  key={mn}
                  type="button"
                  className={`cal-month${i === shown.getMonth() ? ' on' : ''}`}
                  onClick={() => {
                    setShown(new Date(shown.getFullYear(), i, 1));
                    setFocus(new Date(shown.getFullYear(), i, 1));
                    setView('days');
                  }}
                >
                  {mn.slice(0, 3)}
                </button>
              ))}
            </div>
          ) : (
            <div
              role="grid"
              aria-label={`${MONTHS[shown.getMonth()]} ${shown.getFullYear()}`}
              onKeyDown={onGridKey}
            >
              <div className="cal-week" aria-hidden="true">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="cal-days">
                {cells.map((d) => {
                  const inMonth = d.getMonth() === shown.getMonth();
                  const isSel = selected ? sameDay(d, selected) : false;
                  const isFocus = sameDay(d, focus);
                  return (
                    <button
                      key={toIso(d)}
                      ref={isFocus ? focusRef : undefined}
                      type="button"
                      tabIndex={isFocus ? 0 : -1}
                      disabled={disabled(d)}
                      aria-selected={isSel}
                      aria-current={sameDay(d, today) ? 'date' : undefined}
                      className={`cal-day${inMonth ? '' : ' out'}${isSel ? ' on' : ''}${
                        sameDay(d, today) ? ' today' : ''
                      }`}
                      onClick={() => commit(d)}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="cal-foot">
            {required ? (
              <span />
            ) : (
              <button type="button" onClick={() => commit(null)}>
                Clear
              </button>
            )}
            <button type="button" disabled={disabled(today)} onClick={() => commit(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
