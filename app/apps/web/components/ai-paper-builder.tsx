'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LIMITS,
  QUESTION_TYPE_LABELS,
  aiBriefSchema,
  buildAiPrompt,
  buildFixPrompt,
  buildMissingPrompt,
  planParts,
  type AiBrief,
  type AiImportResult,
  type AiPromptPart,
  type ExamDetailDto,
} from '@parakh/shared';
import { ApiError, api } from '../lib/api';
import { Icon } from './icons';
import { Alert, Button, describeError, useModalFocus, Req } from './ui';

// "Build with AI": the trainer describes the paper, copies a prompt into any outside AI and
// pastes the JSON answer back. Parakh never calls an AI service itself.

interface TopicRow {
  name: string;
  notes: string;
  count: string;
}

interface FormState {
  title: string;
  subject: string;
  topics: TopicRow[];
  total: number;
  single: number;
  multi: number;
  written: number;
  easy: number;
  medium: number;
  hard: number;
  /** How hard the whole paper is. The easy/medium/hard counts are derived from it. */
  level: Level;
  optionsPerQuestion: number;
  audience: string;
  language: string;
  includeExplanations: boolean;
  includeRubric: boolean;
  sourceMaterial: string;
  extraInstructions: string;
  avoid: string;
  marksSingle: number;
  marksMulti: number;
  marksWritten: number;
  partialCredit: boolean;
}

type Level = 'easy' | 'medium' | 'hard';
const LEVELS: { key: Level; label: string; hint: string }[] = [
  { key: 'easy', label: 'Easy', hint: 'Recall and basic ideas' },
  { key: 'medium', label: 'Medium', hint: 'Applying what was taught' },
  { key: 'hard', label: 'Hard', hint: 'Analysis and tricky cases' },
];

/** The whole paper has one difficulty, so every question falls in that level. */
function levelCounts(level: Level, total: number) {
  return { easy: 0, medium: 0, hard: 0, [level]: total } as Record<Level, number>;
}

/** The level a saved brief mostly asks for. */
function levelOf(d: { easy: number; medium: number; hard: number }): Level {
  return d.hard > d.medium && d.hard >= d.easy ? 'hard' : d.easy > d.medium ? 'easy' : 'medium';
}

function fromBrief(brief: AiBrief): FormState {
  return {
    title: brief.title,
    subject: brief.subject,
    topics: brief.topics.map((t) => ({
      name: t.name,
      notes: t.notes ?? '',
      count: '',
    })),
    total: brief.total,
    single: brief.types.single,
    multi: brief.types.multi,
    written: brief.types.written,
    easy: brief.difficulty.easy,
    medium: brief.difficulty.medium,
    hard: brief.difficulty.hard,
    level: levelOf(brief.difficulty),
    optionsPerQuestion: brief.optionsPerQuestion,
    audience: brief.audience,
    language: 'English',
    includeExplanations: brief.includeExplanations,
    includeRubric: brief.includeRubric,
    sourceMaterial: brief.sourceMaterial ?? '',
    extraInstructions: brief.extraInstructions ?? '',
    avoid: brief.avoid ?? '',
    marksSingle: brief.marks.single,
    marksMulti: brief.marks.multi,
    marksWritten: brief.marks.written,
    partialCredit: true,
  };
}

/** With a paper plan, the marks for each type come from the plan and cannot be changed here. */
function withPlanMarks(form: FormState, exam: ExamDetailDto): FormState {
  const plan = exam.paperPlan;
  if (!plan) return form;
  return {
    ...form,
    marksSingle: plan.singleMarks,
    marksMulti: plan.multiMarks,
    marksWritten: plan.subjectiveMarks,
  };
}

function initialForm(exam: ExamDetailDto): FormState {
  const saved = aiBriefSchema.safeParse(exam.aiBrief ?? {});
  if (saved.success) return fromBrief(saved.data);
  const total = Math.min(10, LIMITS.MAX_QUESTIONS_PER_EXAM - exam.questionCount) || 1;
  return {
    title: exam.title,
    subject: '',
    topics: [],
    total,
    single: total,
    multi: 0,
    written: 0,
    ...levelCounts('medium', total),
    level: 'medium',
    optionsPerQuestion: 4,
    audience: '',
    language: 'English',
    includeExplanations: true,
    includeRubric: true,
    sourceMaterial: '',
    extraInstructions: '',
    avoid: '',
    marksSingle: 4,
    marksMulti: 4,
    marksWritten: 4,
    partialCredit: true,
  };
}

function toInput(f: FormState) {
  return {
    title: f.title,
    subject: f.subject,
    topics: f.topics.map((t) => ({
      name: t.name,
      notes: t.notes || undefined,
      count: null,
    })),
    total: f.total,
    types: { single: f.single, multi: f.multi, written: f.written },
    difficulty: { easy: f.easy, medium: f.medium, hard: f.hard },
    optionsPerQuestion: f.optionsPerQuestion,
    audience: f.audience,
    language: 'English', // the paper is always in English
    includeExplanations: f.includeExplanations,
    includeRubric: f.includeRubric,
    sourceMaterial: f.sourceMaterial || undefined,
    extraInstructions: f.extraInstructions || undefined,
    avoid: f.avoid || undefined,
    marks: { single: f.marksSingle, multi: f.marksMulti, written: f.marksWritten },
    partialCredit: true,
  };
}

function useCopy() {
  const [copied, setCopied] = useState('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setCopied('');
    }
  }
  return { copied, copy };
}

const AI_SITES = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Gemini', 'https://gemini.google.com/'],
  ['Claude', 'https://claude.ai/'],
] as const;

export function AiPaperBuilder({
  exam,
  reload,
  onGoToPlan,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  /** Takes the trainer to the Paper plan step. */
  onGoToPlan?: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => withPlanMarks(initialForm(exam), exam));
  const [errors, setErrors] = useState<string[]>([]);
  const [brief, setBrief] = useState<AiBrief | null>(null);
  const [imported, setImported] = useState('');
  const room = LIMITS.MAX_QUESTIONS_PER_EXAM - exam.questionCount;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

  // With a paper plan, how many of each type to build is decided by the plan: what it asks for
  // minus what the exam already has. The trainer does not pick it here.
  const plan = exam.paperPlan;
  const have = (t: ExamDetailDto['questions'][number]['type']) =>
    exam.questions.filter((q) => q.type === t).length;
  const toBuild = plan
    ? {
        single: Math.max(0, plan.singleCount - have('SINGLE')),
        multi: Math.max(0, plan.multiCount - have('MULTI')),
        written: Math.max(0, plan.subjectiveCount - have('SUBJECTIVE')),
      }
    : null;
  const base: FormState = toBuild
    ? { ...form, ...toBuild, total: toBuild.single + toBuild.multi + toBuild.written }
    : form;
  const eff: FormState = { ...base, ...levelCounts(form.level, base.total) };

  // With a paper plan the types come from the plan, so they always add up. Only typed-in counts need checking.
  const checks: [boolean, string][] = toBuild
    ? []
    : [
        [
          eff.single + eff.multi + eff.written === eff.total,
          `Types add up to ${eff.single + eff.multi + eff.written} of ${eff.total}`,
        ],
      ];

  function changeTotal(total: number) {
    setForm((f) => ({
      ...f,
      total,
      single: Math.max(0, total - f.multi - f.written),
    }));
  }

  function openPrompt() {
    if (toBuild && eff.total === 0) {
      setErrors([
        'Everything in your paper plan is already added. There is nothing left to build.',
      ]);
      return;
    }
    const parsed = aiBriefSchema.safeParse(toInput(eff));
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((i) => i.message))]);
      return;
    }
    if (parsed.data.total > room) {
      setErrors([`This exam has room for ${room} more questions.`]);
      return;
    }
    setErrors([]);
    setImported('');
    setBrief(parsed.data);
  }

  const topic = (i: number, patch: Partial<TopicRow>) =>
    setForm((f) => ({ ...f, topics: f.topics.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));

  // The paper plan decides how many questions of each type to build, so it comes first.
  if (!plan) {
    return (
      <section className="ai-builder" aria-labelledby="ai-builder-title">
        <h2 id="ai-builder-title" style={{ marginTop: 0 }}>
          Build with AI
        </h2>
        <Alert kind="info">
          Set the paper plan first. The AI builds exactly what the plan asks for: how many single
          answer, multiple answer and written questions, and the marks for each.
        </Alert>
        {onGoToPlan && (
          <Button type="button" onClick={onGoToPlan}>
            Go to Paper plan
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="ai-builder" aria-labelledby="ai-builder-title">
      <header className="tool-head">
        <span className="tool-ico" aria-hidden="true">
          <Icon name="sparkles" size={20} />
        </span>
        <div>
          <h2 id="ai-builder-title" style={{ margin: 0 }}>
            Build with AI
          </h2>
          <p>Describe the paper, get a ready-made prompt, paste the answer back.</p>
        </div>
      </header>
      <ol className="ai-how">
        <li>
          <b>Describe the paper</b>
          <span>Fill in the form below.</span>
        </li>
        <li>
          <b>Copy the prompt</b>
          <span>Paste it into ChatGPT, Gemini or Claude.</span>
        </li>
        <li>
          <b>Paste the answer back</b>
          <span>Check the questions, then add them to this draft.</span>
        </li>
      </ol>
      <p className="ai-note">
        <Icon name="shield" size={16} />
        <span>
          Parakh does not send anything to an AI for you, and nothing is added until you have
          checked it.
        </span>
      </p>
      {imported && <Alert kind="success">{imported}</Alert>}
      {errors.length > 0 && (
        <Alert>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className="req-note">
        <Req /> Required
      </p>

      <div className="ai-steps">
        <fieldset className="ai-step">
          <legend>
            <span className="ai-num">1</span> About the paper
          </legend>
          <div className="row">
            <label className="field">
              <span>
                Paper title <Req />
              </span>
              <input
                value={form.title}
                maxLength={150}
                aria-required="true"
                placeholder="e.g. Computer Networks, Unit Test 1"
                onChange={(e) => set('title', e.target.value)}
              />
              <small>Used in the prompt only. It does not rename the exam.</small>
            </label>
            <label className="field">
              <span>
                Subject or course <Req />
              </span>
              <input
                value={form.subject}
                maxLength={150}
                aria-required="true"
                placeholder="e.g. Computer Networks"
                onChange={(e) => set('subject', e.target.value)}
              />
              <small>What the AI should write questions about.</small>
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>
                Audience and level <Req />
              </span>
              <input
                value={form.audience}
                maxLength={200}
                aria-required="true"
                placeholder="e.g. Final-year B.Tech, beginner"
                onChange={(e) => set('audience', e.target.value)}
              />
              <small>Who will sit the exam, for example their year or experience.</small>
            </label>
          </div>
        </fieldset>

        <fieldset className="ai-step">
          <legend>
            <span className="ai-num">2</span> Topics ({form.topics.length})
          </legend>
          <p className="muted ai-hint">
            Add at least one topic the questions should cover. Parakh shares the questions evenly
            between your topics.
          </p>
          {form.topics.map((t, i) => (
            <div className="ai-topic" key={i}>
              <div className="ai-topic-head">
                <b>Topic {i + 1}</b>
                <Button
                  type="button"
                  variant="secondary"
                  small
                  aria-label={`Remove topic ${i + 1}`}
                  onClick={() =>
                    setForm((f) => ({ ...f, topics: f.topics.filter((_, j) => j !== i) }))
                  }
                >
                  Remove
                </Button>
              </div>
              <div className="ai-topic-fields">
                <label className="field">
                  <span>
                    Topic name <Req />
                  </span>
                  <input
                    aria-label={`Topic ${i + 1} name`}
                    aria-required="true"
                    placeholder="e.g. TCP and UDP"
                    value={t.name}
                    maxLength={100}
                    onChange={(e) => topic(i, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Focus notes</span>
                  <input
                    aria-label={`Topic ${i + 1} focus notes`}
                    placeholder="e.g. handshake, congestion control"
                    value={t.notes}
                    maxLength={300}
                    onChange={(e) => topic(i, { notes: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
          {
            <div>
              <Button
                type="button"
                variant="secondary"
                small
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    topics: [...f.topics, { name: '', notes: '', count: '' }],
                  }))
                }
              >
                {form.topics.length === 0 ? '+ Add a topic' : '+ Add another topic'}
              </Button>
            </div>
          }
        </fieldset>

        <fieldset className="ai-step">
          <legend>
            <span className="ai-num">3</span> Size and mix
          </legend>
          <div className="row">
            {!plan && (
              <label className="field">
                <span>
                  Total questions <Req /> <em>(room for {room} more)</em>
                </span>
                <input
                  type="number"
                  min={1}
                  max={Math.min(LIMITS.MAX_QUESTIONS_PER_EXAM, room)}
                  aria-required="true"
                  value={form.total}
                  onChange={(e) => changeTotal(num(e.target.value))}
                />
                <small>Changing this resets the type split below.</small>
              </label>
            )}
            <label className="field">
              <span>Options per choice question</span>
              <select
                value={form.optionsPerQuestion}
                onChange={(e) => set('optionsPerQuestion', Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} options
                  </option>
                ))}
              </select>
              <small>For single and multiple-answer questions.</small>
            </label>
          </div>

          {plan ? (
            <div className="ai-group">
              <b>Question types (from your paper plan)</b>
              <small className="muted">
                Taken from the plan, minus what is already added. Nothing to fill in here.
              </small>
              <ul className="build-plan">
                {(
                  [
                    ['SINGLE', 'single', plan.singleCount],
                    ['MULTI', 'multi', plan.multiCount],
                    ['SUBJECTIVE', 'written', plan.subjectiveCount],
                  ] as const
                )
                  .filter(([, , planned]) => planned > 0)
                  .map(([type, key, planned]) => {
                    const added = Math.min(have(type), planned);
                    const pct = planned > 0 ? Math.round((added / planned) * 100) : 0;
                    const done = eff[key] === 0;
                    return (
                      <li key={type} className={`bp-row${done ? ' done' : ''}`}>
                        <div className="bp-info">
                          <span className="bp-name">{QUESTION_TYPE_LABELS[type]}</span>
                          <span className="bp-meta">
                            {added} of {planned} added
                          </span>
                          <div className="bp-bar" aria-hidden="true">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="bp-build">
                          {done ? (
                            <span className="bp-ok">Done</span>
                          ) : (
                            <>
                              <b>{eff[key]}</b>
                              <small>to build</small>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
              <p className={`bp-total${eff.total === 0 ? ' done' : ''}`}>
                {eff.total === 0
                  ? 'Everything in the plan is already added.'
                  : `${eff.total} question${eff.total === 1 ? '' : 's'} to build in total`}
              </p>
            </div>
          ) : (
            <div className="ai-group">
              <b>Question types</b>
              <small className="muted">How many of each. They must add up to the total.</small>
              <div className="row">
                {(
                  [
                    ['single', 'Single-answer'],
                    ['multi', 'Multiple-answer'],
                    ['written', 'Written'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={0}
                      value={form[key]}
                      onChange={(e) => set(key, num(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="ai-group">
            <b>Paper difficulty</b>
            <small className="muted">One level for the whole paper.</small>
            <div className="qe-types" role="radiogroup" aria-label="Paper difficulty">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  role="radio"
                  aria-checked={form.level === l.key}
                  className={`qe-type${form.level === l.key ? ' on' : ''}`}
                  title={l.hint}
                  onClick={() => set('level', l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <ul className="ai-checks" aria-live="polite" hidden={checks.length === 0}>
            {checks.map(([ok, label]) => (
              <li key={label} className={ok ? 'ok' : 'bad'}>
                {ok ? '✓' : '✗'} {label}
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="ai-step">
          <legend>
            <span className="ai-num">4</span> Extra instructions
          </legend>
          <Alert kind="info">
            You are about to paste this text into an outside service. Do not include student
            personal data or secrets here. It is saved with this draft so you can come back to it.
          </Alert>
          <label className="field">
            <span>Source material</span>
            <textarea
              value={form.sourceMaterial}
              maxLength={6000}
              placeholder="Paste notes or a chapter the questions should be based on"
              onChange={(e) => set('sourceMaterial', e.target.value)}
            />
            <small>Up to 6000 characters.</small>
          </label>
          <label className="field">
            <span>Extra instructions</span>
            <textarea
              value={form.extraInstructions}
              maxLength={1000}
              placeholder="e.g. Use real-world scenarios; keep each question under two lines"
              onChange={(e) => set('extraInstructions', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Topics or ideas to avoid</span>
            <textarea
              value={form.avoid}
              maxLength={500}
              placeholder="e.g. Do not ask about IPv6"
              onChange={(e) => set('avoid', e.target.value)}
            />
          </label>

          <div className="ai-checkrow">
            <label className="qe-switch">
              <input
                type="checkbox"
                checked={form.includeExplanations}
                onChange={(e) => set('includeExplanations', e.target.checked)}
              />
              <span className="qe-track" aria-hidden="true" />
              Include an explanation for each answer
            </label>
            {eff.written > 0 && (
              <label className="qe-switch">
                <input
                  type="checkbox"
                  checked={form.includeRubric}
                  onChange={(e) => set('includeRubric', e.target.checked)}
                />
                <span className="qe-track" aria-hidden="true" />
                Include a marking guide for written questions
              </label>
            )}
          </div>
        </fieldset>

        <div className="ai-submit">
          <Button type="button" onClick={openPrompt}>
            <Icon name="sparkles" size={16} /> Generate AI prompt
          </Button>
          <small className="muted">
            Next you get a ready-made prompt to copy. Nothing is added to the exam yet.
          </small>
        </div>
      </div>

      {brief && (
        <PromptDialog
          exam={exam}
          brief={brief}
          onClose={() => setBrief(null)}
          onImported={async (message) => {
            setImported(message);
            await reload();
          }}
        />
      )}
    </section>
  );
}

function PromptDialog({
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
