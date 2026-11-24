'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LIMITS,
  QUESTION_TYPE_LABELS,
  paperPlanSchema,
  planTotalMarks,
  type PaperPlan,
} from '@parakh/shared';
import {
  ScheduleFields,
  checkStart,
  toStartValue,
  type StartErrors,
  type StartValue,
} from './schedule-fields';
import { Icon } from './icons';
import { Alert, Button, Req } from './ui';
import { useStepSave, type RegisterSave } from '../lib/step-save';

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

type Kind = keyof typeof QUESTION_TYPE_LABELS;
const KINDS: Kind[] = ['SINGLE', 'MULTI', 'SUBJECTIVE'];
const HINT: Record<Kind, string> = {
  SINGLE: 'One correct option.',
  MULTI: 'Several correct options.',
  SUBJECTIVE: 'Written answers you grade yourself.',
};

interface Row {
  count: string;
  marks: string;
}

/**
 * Step 2 of the New exam workflow: the trainer says how many questions the paper has and, for each
 * of the three kinds (MCQ single, MCQ multiple, subjective), how many there are and how many marks
 * each is worth. The counts must add up to the total. Marks are defined here once, so the question
 * editor does not ask for them again.
 */
export function PaperPlanStep({
  initial,
  onBack,
  onNext,
  save,
  registerSave,
  nextLabel = 'Next: review',
  busy = false,
  error: externalError = '',
  initialStartsAt = null,
  durationMinutes,
}: {
  initial: PaperPlan | null;
  /** Leave out to hide the Back button (when the plan is edited on its own). */
  onBack?: () => void;
  onNext: (plan: PaperPlan, startsAt: string | null) => void;
  /** Stores the plan and start time (edit page). Throws with a readable message when it fails. */
  save?: (plan: PaperPlan, startsAt: string | null) => Promise<void>;
  /** When given, there is no button: the page saves this step when the trainer presses Next. */
  registerSave?: RegisterSave;
  nextLabel?: string;
  busy?: boolean;
  error?: string;
  initialStartsAt?: string | null;
  /** Duration from the Basics step, used to warn when the exam would already be over. */
  durationMinutes?: number;
}) {
  const [start, setStart] = useState<StartValue>(toStartValue(initialStartsAt));
  const [startErrors, setStartErrors] = useState<StartErrors>({});
  const [total, setTotal] = useState(initial ? String(initial.totalQuestions) : '');
  const [rows, setRows] = useState<Record<Kind, Row>>({
    SINGLE: {
      count: initial ? String(initial.singleCount) : '',
      marks: initial ? String(initial.singleMarks) : '',
    },
    MULTI: {
      count: initial ? String(initial.multiCount) : '',
      marks: initial ? String(initial.multiMarks) : '',
    },
    SUBJECTIVE: {
      count: initial ? String(initial.subjectiveCount) : '',
      marks: initial ? String(initial.subjectiveMarks) : '',
    },
  });
  // The trainer first picks which question types the paper has; only those get a row below.
  const [chosen, setChosen] = useState<Record<Kind, boolean>>({
    SINGLE: Boolean(initial && initial.singleCount > 0),
    MULTI: Boolean(initial && initial.multiCount > 0),
    SUBJECTIVE: Boolean(initial && initial.subjectiveCount > 0),
  });
  const [error, setError] = useState('');

  function toggleKind(k: Kind) {
    setChosen((c) => ({ ...c, [k]: !c[k] }));
    // A type that is switched off counts as zero questions and zero marks.
    if (chosen[k]) patch(k, { count: '', marks: '' });
  }

  const patch = (k: Kind, change: Partial<Row>) =>
    setRows((r) => ({ ...r, [k]: { ...r[k], ...change } }));

  const totalNum = num(total);
  const n = (k: Kind) => Number(rows[k].count) || 0;
  const m = (k: Kind) => Number(rows[k].marks) || 0;
  const assigned = n('SINGLE') + n('MULTI') + n('SUBJECTIVE');
  const left = Number.isFinite(totalNum) ? totalNum - assigned : null;
  const totalMarks = planTotalMarks({
    singleCount: n('SINGLE'),
    multiCount: n('MULTI'),
    subjectiveCount: n('SUBJECTIVE'),
    singleMarks: m('SINGLE'),
    multiMarks: m('MULTI'),
    subjectiveMarks: m('SUBJECTIVE'),
  });

  /** Reads the form: the plan and start time when they are valid, otherwise what is wrong. */
  function build():
    | { ok: true; plan: PaperPlan; startsAt: string | null }
    | { ok: false; problem: string; startErrors?: StartErrors } {
    // A kind with no questions does not need marks.
    const marksOf = (k: Kind) =>
      !chosen[k] || (n(k) === 0 && rows[k].marks.trim() === '') ? 0 : num(rows[k].marks);
    const countOf = (k: Kind) => (chosen[k] ? num(rows[k].count) : 0);
    if (!KINDS.some((k) => chosen[k])) {
      return { ok: false, problem: 'Choose at least one question type for this paper.' };
    }
    const parsed = paperPlanSchema.safeParse({
      totalQuestions: totalNum,
      singleCount: countOf('SINGLE'),
      multiCount: countOf('MULTI'),
      subjectiveCount: countOf('SUBJECTIVE'),
      singleMarks: marksOf('SINGLE'),
      multiMarks: marksOf('MULTI'),
      subjectiveMarks: marksOf('SUBJECTIVE'),
    });
    if (!parsed.success) {
      return { ok: false, problem: parsed.error.issues[0]?.message ?? 'Check the plan' };
    }
    const when = checkStart(start, { required: true, durationMinutes });
    if (when.errors.date || when.errors.time) {
      return {
        ok: false,
        problem: 'Choose when the exam starts.',
        startErrors: when.errors,
      };
    }
    return { ok: true, plan: parsed.data, startsAt: when.iso };
  }

  function next() {
    const r = build();
    setStartErrors(r.ok ? {} : (r.startErrors ?? {}));
    if (!r.ok) {
      setError(r.startErrors ? 'Please choose when the exam starts.' : r.problem);
      return;
    }
    setError('');
    onNext(r.plan, r.startsAt);
  }

  // Saved when the trainer presses Next. Returns why it could not be saved, or null.
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!registerSave) return;
    const r = build();
    lastSaved.current = r.ok ? JSON.stringify([r.plan, r.startsAt]) : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerSave]);
  useStepSave(registerSave, async () => {
    const r = build();
    setStartErrors(r.ok ? {} : (r.startErrors ?? {}));
    if (!r.ok) {
      const message = r.startErrors ? 'Please choose when the exam starts.' : r.problem;
      setError(message);
      return message;
    }
    setError('');
    const key = JSON.stringify([r.plan, r.startsAt]);
    if (key === lastSaved.current) return null;
    try {
      await save?.(r.plan, r.startsAt);
      lastSaved.current = key;
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save';
      setError(message);
      return message;
    }
  });

  return (
    <section className="form-section form-full">
      <h3>Plan the paper</h3>
      <p className="card-sub">
        Tell us the shape of the paper first: how many questions of each type, and how many marks
        each one is worth. You add the questions themselves in the next step, and we show how many
        are still to go.
      </p>
      {(error || externalError) && <Alert>{error || externalError}</Alert>}

      <div className="field-row field-row-3" style={{ alignItems: 'start' }}>
        <label className="field">
          <span>
            Total number of questions
            <Req />
          </span>
          <input
            type="number"
            min={1}
            max={LIMITS.MAX_QUESTIONS_PER_EXAM}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
          <small className="muted">The types you choose below must add up to this.</small>
        </label>
      </div>

      <div className="type-pick" role="group" aria-label="Question types in this paper">
        <p className="type-pick-title">
          Which question types does this paper have?
          <Req />
        </p>
        <div className="type-pick-grid">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`type-chip${chosen[k] ? ' on' : ''}`}
              aria-pressed={chosen[k]}
              onClick={() => toggleKind(k)}
            >
              <span className="type-chip-box" aria-hidden="true">
                {chosen[k] && <Icon name="check" size={13} />}
              </span>
              <span className="type-chip-text">
                <b>{QUESTION_TYPE_LABELS[k]}</b>
                <small>{HINT[k]}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="plan-types">
        {KINDS.filter((k) => chosen[k]).map((k) => (
          <div className="plan-type" key={k}>
            <div className="plan-type-name">
              <b>{QUESTION_TYPE_LABELS[k]}</b>
              <small className="muted">{HINT[k]}</small>
            </div>
            <label className="field">
              <span>
                Questions
                <Req />
              </span>
              <input
                type="number"
                min={1}
                max={LIMITS.MAX_QUESTIONS_PER_EXAM}
                aria-label={`${QUESTION_TYPE_LABELS[k]} questions`}
                value={rows[k].count}
                onChange={(e) => patch(k, { count: e.target.value })}
              />
            </label>
            <label className="field">
              <span>
                Marks each
                <Req />
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.25"
                aria-label={`${QUESTION_TYPE_LABELS[k]} marks each`}
                value={rows[k].marks}
                onChange={(e) => patch(k, { marks: e.target.value })}
              />
            </label>
            <div className="plan-type-sum" aria-hidden="true">
              <small className="muted">Marks</small>
              <b>{Math.round(n(k) * m(k) * 100) / 100}</b>
            </div>
          </div>
        ))}
      </div>

      {(() => {
        const anyChosen = KINDS.some((k) => chosen[k]);
        const known = Number.isFinite(totalNum) && totalNum > 0;
        const pct = known ? Math.min(100, Math.round((assigned / totalNum) * 100)) : 0;
        const state = left === null || !anyChosen ? 'idle' : left === 0 ? 'ok' : 'warn';
        const hint =
          state === 'idle'
            ? 'Choose the question types above.'
            : state === 'ok'
              ? 'All questions are assigned.'
              : left! > 0
                ? `${left} more question${left === 1 ? '' : 's'} to assign.`
                : `${-left!} question${left === -1 ? '' : 's'} over the total.`;
        return (
          <div
            className={`plan-summary ${state}`}
            role="status"
            aria-label="Total marks and questions assigned"
          >
            <div className="ps-card">
              <span className="ps-label">Questions assigned</span>
              <div className="ps-figure">
                <b>{assigned}</b>
                {known && <span>of {totalNum}</span>}
              </div>
              <div className="ps-bar" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span className="ps-hint">{hint}</span>
            </div>
            <div className="ps-card ps-marks">
              <span className="ps-label">Total marks</span>
              <div className="ps-figure">
                <b>{totalMarks}</b>
              </div>
              <span className="ps-hint">Fills in as you add marks per question.</span>
            </div>
          </div>
        );
      })()}

      <ScheduleFields
        value={start}
        onChange={(v) => {
          setStart(v);
          setStartErrors({});
        }}
        errors={startErrors}
      />

      {registerSave ? null : (
        <div className="form-actions">
          {onBack && (
            <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
              Back
            </Button>
          )}
          <Button type="button" onClick={next} loading={busy}>
            {nextLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
