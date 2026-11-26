'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAiPrompt,
  buildFixPrompt,
  buildMissingPrompt,
  planParts,
  type AiBrief,
  type AiImportResult,
  type AiPromptPart,
  type ExamDetailDto,
} from '@parakh/shared';
import { ApiError, api } from '../../lib/api';
import { Alert, Button, describeError, useModalFocus } from '../ui';
import { useCopy, AI_SITES } from './form';

export function PromptDialog({
  exam,
  brief,
  onClose,
  onImported,
}: {
  exam: ExamDetailDto;
  brief: AiBrief;
  onClose: () => void;
  onImported: (message: string) => Promise<void>;
}) {
  const parts = useMemo(() => planParts(brief), [brief]);
  const [part, setPart] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);
  const [text, setText] = useState('');
  const [result, setResult] = useState<AiImportResult | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const { copied, copy } = useCopy();
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, boxRef, onClose);

  const prompt = useMemo(() => buildAiPrompt(brief, part), [brief, part]);
  const wanted: AiPromptPart = parts[part];

  useEffect(() => {
    setResult(null);
    setReviewed(false);
    setError('');
    setText('');
  }, [part]);

  async function send(commit: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await api<AiImportResult>(`/exams/${exam.id}/questions-ai-import`, {
        method: 'POST',
        body: { text, brief, partIndex: part, commit },
      });
      setResult(res);
      if (commit) {
        const next = new Set(done).add(part);
        setDone(next);
        await onImported(
          `Added ${res.check.valid.length} questions to the end of this exam. Check the Questions tab.`,
        );
        const more = parts.findIndex((_, i) => !next.has(i));
        if (more >= 0) {
          setPart(more);
          setStep(1);
        } else onClose();
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const check = result?.check ?? null;
  const importable = check ? Math.min(check.valid.length, result?.room ?? 0) : 0;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-dialog-title"
    >
      <div
        className="modal-card"
        ref={boxRef}
        style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}
      >
        <h2 id="ai-dialog-title" style={{ marginTop: 0 }}>
          {step === 1 ? '1. Copy the prompt' : '2. Paste the AI answer'}
        </h2>

        {parts.length > 1 && (
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            {parts.map((p, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={part === i}
                className="tab"
                onClick={() => {
                  setPart(i);
                  setStep(1);
                }}
              >
                Part {i + 1} of {parts.length}
                {done.has(i) ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="stack">
            <p className="muted">
              Copy this prompt, paste it into an AI chat, and wait for the JSON answer.
              {parts.length > 1 && ` This part asks for ${wanted.size} questions.`}
            </p>
            <textarea
              readOnly
              aria-label="Prompt for the AI"
              value={prompt}
              style={{ width: '100%', minHeight: 260, font: 'inherit' }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="toolbar">
              <Button type="button" onClick={() => void copy(prompt, 'prompt')}>
                {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
              </Button>
              {AI_SITES.map(([name, url]) => (
                <a
                  key={name}
                  className="btn btn-secondary btn-link"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {name}
                </a>
              ))}
            </div>
            <div className="toolbar">
              <Button type="button" onClick={() => setStep(2)}>
                Next: paste the AI answer
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            {error && <Alert>{error}</Alert>}
            <label className="field">
              <span>The AI answer (the JSON, pasted as it came)</span>
              <textarea
                value={text}
                style={{ minHeight: 180 }}
                onChange={(e) => {
                  setText(e.target.value);
                  setResult(null);
                  setReviewed(false);
                }}
              />
            </label>
            <div className="toolbar">
              <Button
                type="button"
                loading={busy}
                disabled={!text.trim()}
                onClick={() => void send(false)}
              >
                Check
              </Button>
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                Back to the prompt
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>

            <div aria-live="polite">
              {check?.fatal && <Alert>{check.fatal}</Alert>}
              {check && !check.fatal && (
                <div className="stack">
                  <p>
                    <strong>
                      Found {check.found} of {wanted.size} asked for.
                    </strong>{' '}
                    {check.valid.length} can be imported
                    {check.problems.length > 0 && `, ${check.problems.length} have problems`}.{' '}
                    Single-answer {check.byType.SINGLE}, multiple-answer {check.byType.MULTI},
                    written {check.byType.SUBJECTIVE}.
                  </p>
                  {check.warnings.length > 0 && (
                    <Alert kind="info">
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {check.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                  {check.problems.length > 0 && (
                    <Alert>
                      <strong>These questions cannot be imported:</strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {check.problems.map((p) => (
                          <li key={p.number}>
                            Question {p.number}: {p.message}
                          </li>
                        ))}
                      </ul>
                      <div className="toolbar" style={{ marginTop: 8 }}>
                        <Button
                          type="button"
                          variant="secondary"
                          small
                          onClick={() => void copy(buildFixPrompt(check.problems), 'fix')}
                        >
                          {copied === 'fix' ? 'Copied' : 'Copy fix prompt'}
                        </Button>
                      </div>
                    </Alert>
                  )}
                  {check.valid.length < wanted.size && (
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        small
                        onClick={() => void copy(buildMissingPrompt(check, wanted), 'missing')}
                      >
                        {copied === 'missing' ? 'Copied' : 'Copy missing-questions prompt'}
                      </Button>
                    </div>
                  )}

                  <ol style={{ paddingLeft: 20, maxHeight: 260, overflow: 'auto' }}>
                    {check.valid.map((q) => (
                      <li key={q.number} style={{ marginBottom: 8 }}>
                        <div>{q.input.body}</div>
                        {q.input.type !== 'SUBJECTIVE' ? (
                          <div className="muted">
                            {q.input.options.map((o, i) => (
                              <div
                                key={i}
                                style={
                                  q.input.type !== 'SUBJECTIVE' &&
                                  q.input.correctOptions.includes(i)
                                    ? { color: 'var(--success)', fontWeight: 700 }
                                    : undefined
                                }
                              >
                                {String.fromCharCode(65 + i)}. {o}
                                {q.input.type !== 'SUBJECTIVE' && q.input.correctOptions.includes(i)
                                  ? ' (correct)'
                                  : ''}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="muted">Written answer</div>
                        )}
                      </li>
                    ))}
                  </ol>

                  {importable > 0 && (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          onChange={(e) => setReviewed(e.target.checked)}
                        />
                        I have reviewed the answer key. AI answers can be wrong.
                      </label>
                      <div>
                        <Button
                          type="button"
                          loading={busy}
                          disabled={!reviewed}
                          onClick={() => void send(true)}
                        >
                          Import {importable} question{importable === 1 ? '' : 's'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
