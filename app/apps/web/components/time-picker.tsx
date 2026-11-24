'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { Req } from './ui';

type Meridiem = 'AM' | 'PM';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** "HH:mm" (24h) -> 12h parts, or null when empty or invalid. */
function parse(value: string): { h: number; m: number; ap: Meridiem } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h24 = Number(match[1]);
  const m = Number(match[2]);
  if (h24 > 23 || m > 59) return null;
  return { h: h24 % 12 || 12, m, ap: h24 >= 12 ? 'PM' : 'AM' };
}

function to24(h: number, m: number, ap: Meridiem): string {
  const h24 = (h % 12) + (ap === 'PM' ? 12 : 0);
  return `${pad(h24)}:${pad(m)}`;
}

const display = (value: string) => {
  const p = parse(value);
  return p ? `${pad(p.h)}:${pad(p.m)} ${p.ap}` : '';
};

/**
 * A time input with a modern popup: scrollable hour and minute lists and an AM/PM switch. The
 * chosen time is kept as "HH:mm" (24h) in a hidden input named `name`, so it works inside a plain
 * <form> exactly like <input type="time">. Every pick is applied at once; "Done" just closes it.
 */
export function TimePicker({
  label,
  required,
  name,
  defaultValue = '',
  error,
  ariaLabel,
  onChange,
  placeholder = 'HH:MM AM/PM',
}: {
  label?: string;
  /** Marks the field with a red asterisk. */
  required?: boolean;
  name: string;
  defaultValue?: string;
  error?: string;
  ariaLabel?: string;
  onChange?: (value: string) => void;
  /** Shown while no time is chosen: a format hint, so it does not repeat the label. */
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  const parts = parse(value);

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

  /** Keep the chosen hour and minute in view inside their lists (without moving the page). */
  function centreSelected() {
    for (const list of [hourRef.current, minuteRef.current]) {
      const on = list?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (list && on) list.scrollTop = on.offsetTop - list.clientHeight / 2 + on.clientHeight / 2;
    }
  }
  useEffect(() => {
    if (open) centreSelected();
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setUp(true);
    setOpen(true);
  }

  function apply(next: string) {
    setValue(next);
    onChange?.(next);
  }

  /** Change one part of the time; the parts not chosen yet start at 9:00 AM. */
  function pick(change: Partial<{ h: number; m: number; ap: Meridiem }>) {
    const base = parts ?? { h: 9, m: 0, ap: 'AM' as Meridiem };
    const next = { ...base, ...change };
    apply(to24(next.h, next.m, next.ap));
  }

  function step(list: number[], current: number | undefined, delta: number) {
    const i = current === undefined ? 0 : list.indexOf(current) + delta;
    return list[Math.min(list.length - 1, Math.max(0, i))];
  }

  function onListKey(e: React.KeyboardEvent, kind: 'h' | 'm') {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    if (kind === 'h') pick({ h: step(HOURS, parts?.h, delta) });
    else pick({ m: step(MINUTES, parts?.m, delta) });
    // Move keyboard focus with the selection.
    requestAnimationFrame(() => {
      const list = kind === 'h' ? hourRef.current : minuteRef.current;
      list?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
      centreSelected();
    });
  }

  function now() {
    const d = new Date();
    const hh = d.getHours();
    apply(to24(hh % 12 || 12, d.getMinutes(), hh >= 12 ? 'PM' : 'AM'));
    requestAnimationFrame(centreSelected);
  }

  return (
    <div className="field time-field" ref={rootRef}>
      {label && (
        <span>
          {label}
          {required && <Req />}
        </span>
      )}
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        className="time-trigger"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        aria-invalid={error ? true : undefined}
      >
        <span className={display(value) ? '' : 'time-placeholder'}>
          {display(value) || placeholder}
        </span>
        <Icon name="clock" size={18} />
      </button>
      {error && <small className="error-text">{error}</small>}

      {open && (
        <div
          ref={popRef}
          className={`cal-pop time-pop${up ? ' clock-pop-up' : ''}`}
          role="dialog"
          aria-label="Pick a time"
        >
          <div className="time-pop-head">
            <span className="time-pop-label">Select time</span>
            <b className={parts ? '' : 'time-pop-empty'}>{display(value) || '--:-- --'}</b>
          </div>

          <div className="time-cols">
            <div className="time-col-wrap">
              <small>Hour</small>
              <div
                className="time-col"
                ref={hourRef}
                role="listbox"
                aria-label="Hour"
                onKeyDown={(e) => onListKey(e, 'h')}
              >
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    role="option"
                    aria-selected={parts?.h === h}
                    tabIndex={parts?.h === h || (!parts && h === 9) ? 0 : -1}
                    className={`time-item${parts?.h === h ? ' on' : ''}`}
                    onClick={() => pick({ h })}
                  >
                    {pad(h)}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-col-wrap">
              <small>Minute</small>
              <div
                className="time-col"
                ref={minuteRef}
                role="listbox"
                aria-label="Minute"
                onKeyDown={(e) => onListKey(e, 'm')}
              >
                {MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={parts?.m === m}
                    tabIndex={parts?.m === m || (!parts && m === 0) ? 0 : -1}
                    className={`time-item${parts?.m === m ? ' on' : ''}`}
                    onClick={() => pick({ m })}
                  >
                    {pad(m)}
                  </button>
                ))}
              </div>
            </div>
            <div className="time-col-wrap">
              <small>&nbsp;</small>
              <div className="time-ampm" role="group" aria-label="AM or PM">
                {(['AM', 'PM'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`time-item${parts?.ap === v ? ' on' : ''}`}
                    aria-pressed={parts?.ap === v}
                    onClick={() => pick({ ap: v })}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cal-foot">
            {required ? (
              <button type="button" onClick={now}>
                Now
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  apply('');
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
            <span className="time-foot-gap" />
            {!required && (
              <button type="button" onClick={now}>
                Now
              </button>
            )}
            <button type="button" className="time-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
