'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Our own confirm / prompt boxes, used instead of the browser's plain window.confirm and
 * window.prompt. Call `await confirmDialog(...)` or `await promptDialog(...)` from any handler;
 * <DialogHost /> (mounted once in the root layout) draws the box.
 */

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for things that cannot be undone. */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  /** Short label above the field. */
  label?: string;
  placeholder?: string;
  /** Minimum characters after trimming; the box will not submit with less. */
  minLength?: number;
  /** One line (email, letters) instead of a text area. */
  singleLine?: boolean;
  defaultValue?: string;
}

type Request =
  | { kind: 'confirm'; message: string; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: 'prompt';
      message: string;
      opts: PromptOptions;
      resolve: (value: string | null) => void;
    };

let show: ((r: Request) => void) | null = null;
const waiting: Request[] = [];

function push(r: Request) {
  if (show) show(r);
  else waiting.push(r);
}

/** Resolves true when the user confirms, false when they cancel. */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => push({ kind: 'confirm', message, opts, resolve }));
}

/** Resolves the trimmed text, or null when the user cancels. */
export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => push({ kind: 'prompt', message, opts, resolve }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const current = queue[0];

  useEffect(() => {
    show = (r) => setQueue((q) => [...q, r]);
    for (const r of waiting.splice(0)) show(r);
    return () => {
      show = null;
    };
  }, []);

  if (!current) return null;
  const done = () => setQueue((q) => q.slice(1));
  return <DialogBox key={queue.length + current.message} request={current} onDone={done} />;
}

function DialogBox({ request, onDone }: { request: Request; onDone: () => void }) {
  const { opts } = request;
  const isPrompt = request.kind === 'prompt';
  const [value, setValue] = useState(
    request.kind === 'prompt' ? (request.opts.defaultValue ?? '') : '',
  );
  const [touched, setTouched] = useState(false);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const min = request.kind === 'prompt' ? (request.opts.minLength ?? 1) : 0;
  const tooShort = isPrompt && value.trim().length < min;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (isPrompt ? fieldRef.current : okRef.current)?.focus();
    return () => previous?.focus?.();
  }, [isPrompt]);

  function close(result: boolean) {
    if (request.kind === 'confirm') request.resolve(result);
    else request.resolve(result && !tooShort ? value.trim() : null);
    onDone();
  }

  function submit() {
    if (tooShort) {
      setTouched(true);
      return;
    }
    close(true);
  }

  const paragraphs = request.message.split(/\n{2,}/);
  const title =
    opts.title ?? (isPrompt ? 'Please tell us' : opts.danger ? 'Are you sure?' : 'Please confirm');

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close(false);
          } else if (e.key === 'Enter' && isPrompt && (opts as PromptOptions).singleLine) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Enter' && isPrompt && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        <div className="dialog-body">
          {paragraphs.map((p, i) => (
            <p key={i} style={{ whiteSpace: 'pre-line' }}>
              {p}
            </p>
          ))}
        </div>
        {request.kind === 'prompt' && (
          <label className="field" style={{ marginTop: 4 }}>
            {request.opts.label && <span>{request.opts.label}</span>}
            {request.opts.singleLine ? (
              <input
                ref={fieldRef}
                value={value}
                placeholder={request.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={touched && tooShort ? true : undefined}
              />
            ) : (
              <textarea
                ref={fieldRef}
                rows={3}
                value={value}
                placeholder={request.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={touched && tooShort ? true : undefined}
              />
            )}
            {touched && tooShort && (
              <small className="error-text">
                {min > 1 ? `Please write at least ${min} characters.` : 'This cannot be empty.'}
              </small>
            )}
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={submit}
          >
            {opts.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
