'use client';

import { useState } from 'react';
import {
  LIMITS,
  QUESTION_TYPE_LABELS,
  aiBriefSchema,
  type AiBrief,
  type ExamDetailDto,
} from '@parakh/shared';
import { Icon } from './icons';
import { Alert, Button, Req } from './ui';
import {
  TopicRow,
  FormState,
  LEVELS,
  levelCounts,
  withPlanMarks,
  initialForm,
  toInput,
} from './ai-paper/form';
import { PromptDialog } from './ai-paper/prompt-dialog';

// "Build with AI": the trainer describes the paper, copies a prompt into any outside AI and
// pastes the JSON answer back. Parakh never calls an AI service itself.

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
