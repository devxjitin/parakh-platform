'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QUESTION_TYPE_LABELS,
  planMarksFor,
  planTotalMarks,
  type ExamDetailDto,
  type ExamQuestionDto,
  type PaperPlan,
} from '@parakh/shared';
import { AiPaperBuilder } from '../../../components/ai-paper-builder';
import { Icon, type IconName } from '../../../components/icons';
import { ExamSettingsForm } from '../../../components/exam-settings-form';
import { ExtraTimePanel } from '../../../components/extra-time-panel';
import { ExamControls } from '../../../components/exam-controls';
import { PublishPanel } from '../../../components/publish-panel';
import { CertificatePanel } from '../../../components/certificate-panel';
import { ExamStepper, PAPER_STEPS } from '../../../components/exam-stepper';
import { PaperPlanStep } from '../../../components/paper-plan-step';
import { ImportPreview } from '../../../components/import-preview';
import { PlanProgress } from '../../../components/plan-progress';
import {
  EMPTY_PAYER,
  PaymentStep,
  parseStudentEmails,
  type PayerChoice,
} from '../../../components/payment-step';
import { ResultsPanel } from '../../../components/results-panel';
import { QuestionEditor } from '../../../components/question-editor';
import { QuestionImage, QuestionText } from '../../../components/question-content';
import {
  Alert,
  Button,
  Shell,
  StatusBadge,
  describeError,
  useQueryParam,
} from '../../../components/ui';
import { ApiError, api, apiBlob } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { confirmDialog } from '../../../components/dialogs';
import type { RegisterSave, StepSaver } from '../../../lib/step-save';

type Tab =
  'questions' | 'settings' | 'plan' | 'logo' | 'certificate' | 'payment' | 'publish' | 'results';

// Draft exams follow the guided paper workflow. Wizard step keys (see PAPER_STEPS) map onto tabs.
const STEP_TO_TAB: Record<string, Tab> = {
  basics: 'settings',
  plan: 'plan',
  questions: 'questions',
  logo: 'logo',
  certificate: 'certificate',
  payment: 'payment',
  publish: 'publish',
};
const TAB_TO_STEP: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_TO_TAB).map(([step, tab]) => [tab, step]),
);

/** Paper plan step: the plan (total, types, marks) and the schedule, editable until it is published. */
function PlanEditor({
  exam,
  reload,
  registerSave,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  registerSave: RegisterSave;
}) {
  const plan = exam.paperPlan;

  // Saved when the trainer presses Next (see `registerSave`).
  async function save(next: PaperPlan, startsAt: string | null, endsAt: string | null) {
    try {
      // endsAt null = closes when its time is up (start plus duration).
      await api(`/exams/${exam.id}`, {
        method: 'PATCH',
        body: { paperPlan: next, startsAt, endsAt },
      });
    } catch (err) {
      throw new Error(describeError(err).message);
    }
    await reload();
  }

  const left = plan ? plan.totalQuestions - exam.questionCount : 0;
  return (
    <div>
      <PlanProgress exam={exam} />
      <PaperPlanStep
        initial={plan}
        initialStartsAt={exam.startsAt}
        initialEndsAt={exam.endsAt}
        durationMinutes={exam.durationMinutes}
        alwaysOpen={exam.alwaysOpen}
        onNext={() => undefined}
        save={save}
        registerSave={registerSave}
      />
    </div>
  );
}

/** How many questions of each type the exam has so far. */
function addedByType(exam: ExamDetailDto) {
  const count = (t: ExamQuestionDto['type']) => exam.questions.filter((q) => q.type === t).length;
  return { SINGLE: count('SINGLE'), MULTI: count('MULTI'), SUBJECTIVE: count('SUBJECTIVE') };
}

/** How many questions of this type the plan asks for. */
const planCountFor = (
  p: { singleCount: number; multiCount: number; subjectiveCount: number },
  t: ExamQuestionDto['type'],
) => (t === 'SINGLE' ? p.singleCount : t === 'MULTI' ? p.multiCount : p.subjectiveCount);

/** The steps this exam goes through (a NandiVex-run exam has no trainer logo and no creation fee). */
function stepsFor(exam: ExamDetailDto) {
  return exam.nandivexHosted
    ? PAPER_STEPS.filter((s) => s.key !== 'logo' && s.key !== 'payment')
    : PAPER_STEPS;
}

/**
 * What is still missing before a step counts as complete (null = complete). A step can only be
 * opened once every step before it is complete.
 *  - Basics, Plan and Certificate are saved by Next; Logo is optional and always has a valid value (the logo is
 *    optional; the certificate starts from the default design).
 *  - Plan needs a valid plan and a start time.
 *  - Questions needs every planned question added, per type.
 *  - Payment needs at least one valid email when the trainer buys the seats.
 */
function stepProblem(exam: ExamDetailDto, key: string, payer: PayerChoice): string | null {
  const plan = exam.paperPlan;
  switch (key) {
    case 'plan':
      return plan && (exam.alwaysOpen || exam.startsAt)
        ? null
        : 'Complete the paper plan (total questions, types and marks) and choose the start time.';
    case 'questions': {
      if (!plan) return 'Complete the paper plan first.';
      const added = addedByType(exam);
      const open = (['SINGLE', 'MULTI', 'SUBJECTIVE'] as const).some(
        (k) => added[k] !== planCountFor(plan, k),
      );
      return open
        ? `Add all ${plan.totalQuestions} planned questions to continue, or change the paper plan.`
        : null;
    }
    case 'payment': {
      if (payer.mode !== 'TRAINER') return null;
      const { emails, bad } = parseStudentEmails(payer.emailText);
      if (emails.length === 0)
        return 'Add at least one student email, or let students pay themselves.';
      if (bad.length) return `Fix these email addresses: ${bad.join(', ')}`;
      return null;
    }
    default:
      return null;
  }
}

/**
 * What stops the Next button. The basics and plan steps are saved by Next itself, so they never
 * block it here: pressing it checks and saves the form and shows what is wrong.
 */
function gateProblem(exam: ExamDetailDto, key: string, payer: PayerChoice): string | null {
  return key === 'plan' ? null : stepProblem(exam, key, payer);
}

/** Index of the furthest step that can be opened: the first incomplete one. */
function furthestStep(exam: ExamDetailDto, steps: { key: string }[], payer: PayerChoice): number {
  const open = steps.findIndex((s) => stepProblem(exam, s.key, payer) !== null);
  return open === -1 ? steps.length - 1 : open;
}

const TYPE_LABEL = QUESTION_TYPE_LABELS;

interface ImportResult {
  committed: boolean;
  found: number;
  importable: number;
  questions: { type: string; body: string; options: string[]; correctOptions: number[] }[];
}

type AddMode = 'write' | 'paste' | 'ai';

const ADD_MODES: { key: AddMode; icon: IconName; title: string; text: string }[] = [
  { key: 'write', icon: 'edit', title: 'Write a question', text: 'Add one question at a time' },
  { key: 'paste', icon: 'upload', title: 'Paste as text', text: 'Import many from plain text' },
  { key: 'ai', icon: 'sparkles', title: 'Build with AI', text: 'Describe a paper, get questions' },
];

function QuestionsTab({
  exam,
  reload,
  locked,
  onGoToPlan,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  locked: boolean;
  onGoToPlan?: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // The question being written in the add editor (it exists as soon as it is valid).
  const [liveId, setLiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<AddMode | null>(null);
  const [error, setError] = useState('');
  const base = `/exams/${exam.id}`;

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    }
  }

  const move = (index: number, delta: number) => {
    const ids = exam.questions.map((q) => q.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run(() => api(`${base}/questions-order`, { method: 'PUT', body: { questionIds: ids } }));
  };

  return (
    <div>
      {error && <Alert>{error}</Alert>}
      <PlanProgress exam={exam} />
      {!locked && (
        <section className="add-panel" aria-label="Add questions">
          <div className="add-head">
            <h2>Add questions</h2>
            <p className="muted">
              Write them yourself, paste many at once, or build a whole paper with AI.
            </p>
          </div>
          <div className="add-options" role="group" aria-label="How to add questions">
            {ADD_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`add-option${mode === m.key ? ' on' : ''}`}
                aria-pressed={mode === m.key}
                onClick={() => setMode(mode === m.key ? null : m.key)}
              >
                <span className="add-option-ico">
                  <Icon name={m.icon} size={20} />
                </span>
                <span>
                  <b>{m.title}</b>
                  <small>{m.text}</small>
                </span>
              </button>
            ))}
          </div>
          {mode === 'write' && (
            <div className="add-body">
              <QuestionEditor
                examId={exam.id}
                plan={exam.paperPlan}
                onDone={() => {
                  setMode(null);
                  setLiveId(null);
                }}
                onSave={async (input, id) => {
                  const q = id
                    ? await api<ExamQuestionDto>(`${base}/questions/${id}`, {
                        method: 'PUT',
                        body: input,
                      })
                    : await api<ExamQuestionDto>(`${base}/questions`, {
                        method: 'POST',
                        body: input,
                      });
                  // The open editor now owns this question, so the list does not show it twice.
                  setLiveId(q.id);
                  await reload();
                  return q.id;
                }}
              />
            </div>
          )}
          {mode === 'paste' && (
            <div className="add-body">
              <PasteQuestions exam={exam} reload={reload} />
            </div>
          )}
          {mode === 'ai' && (
            <div className="add-body">
              <AiPaperBuilder exam={exam} reload={reload} onGoToPlan={onGoToPlan} />
            </div>
          )}
        </section>
      )}
      {exam.questions.map((q: ExamQuestionDto, i) =>
        q.id === liveId && mode === 'write' ? null : editing === q.id ? (
          <QuestionEditor
            key={q.id}
            initial={q}
            examId={exam.id}
            plan={exam.paperPlan}
            onDone={() => setEditing(null)}
            onSave={async (input) => {
              await api(`${base}/questions/${q.id}`, { method: 'PUT', body: input });
              await reload();
              return q.id;
            }}
          />
        ) : (
          <div className="q-item" key={q.id}>
            <div className="toolbar">
              <strong>Q{q.position}</strong>
              <span className="badge">{TYPE_LABEL[q.type]}</span>
              <span className="muted">{q.marks} marks</span>
              <span className="spacer" />
              {!locked && (
                <>
                  <Button
                    variant="secondary"
                    small
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={i === exam.questions.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <Button variant="secondary" small onClick={() => setEditing(q.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    small
                    onClick={async () => {
                      const ok = await confirmDialog(`Delete question ${q.position}?`, {
                        title: 'Delete question',
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (ok)
                        await run(() => api(`${base}/questions/${q.id}`, { method: 'DELETE' }));
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
            <div className="q-body">
              <QuestionText text={q.body} markdown={q.markdown} />
              {q.imageAlt && (
                <QuestionImage path={`${base}/questions/${q.id}/image`} alt={q.imageAlt} />
              )}
            </div>
            {q.options.length > 0 && (
              <ul className="q-options">
                {q.options.map((o, idx) => (
                  <li key={idx} className={q.correctOptions.includes(idx) ? 'correct' : ''}>
                    {String.fromCharCode(65 + idx)}. <QuestionText text={o} markdown={q.markdown} />
                  </li>
                ))}
              </ul>
            )}
            {q.rubric && (
              <p className="muted">
                Guidance: <QuestionText text={q.rubric} markdown={q.markdown} />
              </p>
            )}
            {q.explanation && (
              <p className="muted">
                Explanation: <QuestionText text={q.explanation} markdown={q.markdown} />
              </p>
            )}
          </div>
        ),
      )}
      {exam.questions.length === 0 && (
        <p className="muted">
          {locked
            ? 'This exam has no questions.'
            : 'No questions yet. Choose how to add them above.'}
        </p>
      )}
    </div>
  );
}

function PasteQuestions({ exam, reload }: { exam: ExamDetailDto; reload: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [marks, setMarks] = useState('4');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(commit: boolean) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const res = await api<ImportResult>(`/exams/${exam.id}/questions-import`, {
        method: 'POST',
        body: { text, defaultMarks: Number(marks), commit },
      });
      setResult(commit ? null : res);
      if (commit) {
        setText('');
        setDone(`Imported ${res.found} ${res.found === 1 ? 'question' : 'questions'}.`);
        await reload();
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const planMarks: { label: string; marks: number }[] = exam.paperPlan
    ? [
        {
          label: 'MCQ (Single)',
          count: exam.paperPlan.singleCount,
          marks: exam.paperPlan.singleMarks,
        },
        {
          label: 'MCQ (Multiple)',
          count: exam.paperPlan.multiCount,
          marks: exam.paperPlan.multiMarks,
        },
        {
          label: 'Subjective',
          count: exam.paperPlan.subjectiveCount,
          marks: exam.paperPlan.subjectiveMarks,
        },
      ].filter((r) => r.count > 0)
    : [];

  return (
    <div className="tool-form">
      <header className="tool-head">
        <span className="tool-ico" aria-hidden="true">
          <Icon name="upload" size={20} />
        </span>
        <div>
          <h3>Paste questions as text</h3>
          <p>
            Paste many questions at once. We check them first, nothing is added until you import.
          </p>
        </div>
      </header>

      <div className="paste-grid">
        <section className="qe-sec paste-guide">
          <h4>Example</h4>
          <div className="paste-example">
            <div className="paste-example-bar" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <pre className="mono">{`Question 1: Which port does HTTPS use?
A. 80
B. 443
C. 22
Answer: B
Explanation: TLS runs on 443.

Question 2: Which are web servers?
A. Nginx
B. Apache
C. MySQL
Answer: A, B`}</pre>
          </div>
        </section>

        <section className="qe-sec paste-input">
          <div className="qe-head">
            <h4>Your questions</h4>
            <span className="qe-note">
              {text.trim() ? `${text.trim().length} characters` : 'Paste here'}
            </span>
          </div>
          <textarea
            className="qe-body paste-area"
            aria-label="Questions"
            placeholder="Paste your questions here"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
          />
          {exam.paperPlan ? (
            <div className="paste-plan">
              <span className="paste-plan-label">Marks per question, from your paper plan</span>
              <div className="paste-plan-chips">
                {planMarks.map((r) => (
                  <span className="paste-plan-chip" key={r.label}>
                    {r.label}
                    <b>
                      {r.marks} {r.marks === 1 ? 'mark' : 'marks'}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <label className="field paste-marks">
              <span>Marks per question</span>
              <input
                type="number"
                min={0}
                step="0.25"
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
              />
            </label>
          )}
        </section>
      </div>

      {error && <Alert>{error}</Alert>}
      {done && <Alert kind="success">{done}</Alert>}
      {result && <ImportPreview questions={result.questions} />}
      <div className="qe-actions">
        <Button
          variant={result ? 'secondary' : 'primary'}
          loading={busy}
          disabled={!text.trim()}
          onClick={() => send(false)}
        >
          Check the text
        </Button>
        {result && (
          <Button loading={busy} onClick={() => send(true)}>
            Import {result.found} {result.found === 1 ? 'question' : 'questions'}
          </Button>
        )}
      </div>
    </div>
  );
}

function LogoTab({
  exam,
  reload,
  locked,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  locked: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (exam.hasLogo) {
      apiBlob(`/exams/${exam.id}/logo`)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [exam.id, exam.hasLogo, exam.updatedAt]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > 512 * 1024) return setError('The logo must be 512 KB or smaller.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/exams/${exam.id}/logo`, { method: 'PUT', body: form });
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Your logo appears on the certificates for this exam, next to the NandiVex Technologies logo.
        Use a PNG or JPEG, up to 512 KB.
      </p>
      {error && <Alert>{error}</Alert>}
      {url && <img className="logo-preview" src={url} alt="Exam logo" />}
      {!exam.hasLogo && <p className="muted">No logo yet.</p>}
      {!locked && (
        <div className="toolbar">
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            {busy ? 'Uploading…' : exam.hasLogo ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {exam.hasLogo && (
            <Button
              variant="danger"
              onClick={() => api(`/exams/${exam.id}/logo`, { method: 'DELETE' }).then(reload)}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function EditExamPage() {
  const { user, loading } = useRequireAuth();
  const id = useQueryParam('id');
  const [exam, setExam] = useState<ExamDetailDto | null>(null);
  const [error, setError] = useState('');
  const startStep = useQueryParam('step');
  const [tab, setTab] = useState<Tab>('questions');
  const [payer, setPayer] = useState<PayerChoice>(EMPTY_PAYER);
  const startedRef = useRef(false);

  // The New exam page sends the trainer here with ?step=logo so the workflow carries on in order.
  useEffect(() => {
    if (startedRef.current || !startStep) return;
    startedRef.current = true;
    const t = STEP_TO_TAB[startStep];
    if (t) setTab(t);
  }, [startStep]);

  // NandiVex-run exams skip the Logo and Payment steps.
  useEffect(() => {
    if (exam?.nandivexHosted && (tab === 'logo' || tab === 'payment')) setTab('certificate');
  }, [exam?.nandivexHosted, tab]);

  // Keep the current step in the address so Back from a policy page lands on the same step.
  useEffect(() => {
    const step = TAB_TO_STEP[tab];
    if (!id || !step) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('step') === step) return;
    // A step in the address that has not been applied yet wins over the default tab.
    if (url.searchParams.get('step') && !startedRef.current) return;
    url.searchParams.set('step', step);
    window.history.replaceState(window.history.state, '', url);
  }, [tab, id]);

  // Remember the Payment choice while the trainer moves around (and across a refresh).
  useEffect(() => {
    if (!id) return;
    try {
      const saved = window.sessionStorage.getItem(`parakh.payer.${id}`);
      if (saved) setPayer({ ...EMPTY_PAYER, ...(JSON.parse(saved) as Partial<PayerChoice>) });
    } catch {
      /* private mode: the choice just is not remembered */
    }
  }, [id]);
  const updatePayer = (next: PayerChoice) => {
    setPayer(next);
    try {
      window.sessionStorage.setItem(`parakh.payer.${id}`, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };

  // The open step registers how to save itself; Next (and Back) call it before moving on.
  const stepSave = useRef<StepSaver | null>(null);
  const registerSave = useCallback<RegisterSave>((fn) => {
    stepSave.current = fn;
  }, []);
  const [nav, setNav] = useState({ busy: false, error: '' });

  // A draft can only be at a step whose earlier steps are all complete. This also moves the trainer
  // back when something earlier becomes incomplete (a question is deleted, the plan is changed).
  useEffect(() => {
    if (!exam || exam.status !== 'DRAFT') return;
    const steps = stepsFor(exam);
    const gate = furthestStep(exam, steps, payer);
    const current = steps.findIndex((st) => st.key === TAB_TO_STEP[tab]);
    if (current > gate) setTab(STEP_TO_TAB[steps[gate].key]);
  }, [exam, payer, tab]);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setExam(await api<ExamDetailDto>(`/exams/${id}`));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Exam not found.'
          : 'Could not load the exam.',
      );
    }
  }, [id]);

  useEffect(() => {
    if (user?.role === 'EXAMINER' || user?.role === 'ADMIN') void reload();
  }, [user, reload]);

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'EXAMINER' && user.role !== 'ADMIN') {
    return (
      <Shell wide>
        <Alert>Only trainers can build exams.</Alert>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell wide>
        <Alert>{error}</Alert>
        <Link href="/exams/">Back to exams</Link>
      </Shell>
    );
  }
  if (!exam) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }

  /**
   * Moves to another step after saving the open one. Going forward needs the save to work (the
   * reason is shown); going back never traps the trainer, so a failed save does not stop them.
   */
  async function go(stepKey: string, forward: boolean) {
    if (nav.busy) return;
    setNav({ busy: true, error: '' });
    const problem = stepSave.current ? await stepSave.current() : null;
    if (problem && forward) {
      setNav({ busy: false, error: problem });
      return;
    }
    setNav({ busy: false, error: '' });
    setTab(STEP_TO_TAB[stepKey] ?? 'questions');
  }

  const locked = exam.status !== 'DRAFT';
  const steps = stepsFor(exam);
  const furthest = furthestStep(exam, steps, payer);
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === (TAB_TO_STEP[tab] ?? 'questions')),
  );
  const tabs: [Tab, string][] = [
    ['questions', `Questions (${exam.questionCount})`],
    ['settings', 'Settings'],
    // Always shown: the trainer turns certificates on or off inside the Certificate tab.
    ...(exam.nandivexHosted ? [] : ([['logo', 'Logo']] as [Tab, string][])),
    ['certificate', 'Certificate'],
    ['publish', locked ? 'Share' : 'Publish'],
    // Seats are bought once, when publishing (Publish tab), not afterwards.
    ...(locked ? ([['results', 'Results']] as [Tab, string][]) : []),
  ];

  return (
    <Shell wide>
      <div className="topbar">
        <div>
          <h1 className="exam-title">{exam.title}</h1>
          <div className="exam-meta">
            <StatusBadge status={exam.status} />
            <span className="meta-chip">
              <Icon name="book" size={15} />
              <b>{exam.questionCount}</b> {exam.questionCount === 1 ? 'question' : 'questions'}
            </span>
            <span className="meta-chip">
              <Icon name="award" size={15} />
              <b>{exam.totalMarks}</b> {exam.totalMarks === 1 ? 'mark' : 'marks'}
            </span>
            <span className="meta-chip">
              <Icon name="clock" size={15} />
              <b>{exam.durationMinutes}</b> min
            </span>
          </div>
        </div>
        <div className="toolbar">
          <Link className="btn btn-secondary btn-link" href="/exams/">
            Back to exams
          </Link>
          <Link className="btn btn-primary btn-link" href={`/exams/preview/?id=${exam.id}`}>
            Preview as student
          </Link>
          {!locked && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await confirmDialog('Delete this draft exam and all its questions?'))) return;
                await api(`/exams/${exam.id}`, { method: 'DELETE' });
                window.location.href = '/exams/';
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <Alert kind="info">
          This exam is {exam.status.replace(/_/g, ' ').toLowerCase()} and can no longer be edited.
        </Alert>
      )}

      {locked ? (
        <div className="tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className="tab"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <ExamStepper
          steps={steps}
          current={TAB_TO_STEP[tab] ?? 'questions'}
          onSelect={(key) => void go(key, steps.findIndex((st) => st.key === key) > stepIndex)}
          canSelect={(_key, index) => index <= furthest}
        />
      )}

      <section className="card">
        {tab === 'questions' && (
          <QuestionsTab
            exam={exam}
            reload={reload}
            locked={locked}
            onGoToPlan={() => setTab('plan')}
          />
        )}
        {tab === 'settings' &&
          (locked ? (
            <Alert kind="info">Settings are locked.</Alert>
          ) : (
            <ExamSettingsForm
              initial={exam}
              submitLabel="Save settings"
              registerSave={registerSave}
              onSubmit={async (values) => {
                await api(`/exams/${exam.id}`, { method: 'PATCH', body: values });
                await reload();
              }}
            />
          ))}
        {tab === 'plan' && (
          <>
            <PlanEditor exam={exam} reload={reload} registerSave={registerSave} />
          </>
        )}
        {tab === 'logo' && <LogoTab exam={exam} reload={reload} locked={locked} />}
        {tab === 'certificate' && (
          <CertificatePanel exam={exam} reload={reload} registerSave={registerSave} />
        )}
        {tab === 'results' && (
          <>
            <ExtraTimePanel exam={exam} />
            <ResultsPanel exam={exam} reload={reload} />
          </>
        )}
        {tab === 'payment' && <PaymentStep exam={exam} value={payer} onChange={updatePayer} />}
        {tab === 'publish' && (
          <>
            <PublishPanel
              exam={exam}
              userName={user.name}
              userEmail={user.email}
              reload={reload}
              payer={payer}
              onEditPayment={locked ? undefined : () => setTab('payment')}
            />
            <ExamControls exam={exam} reload={reload} />
          </>
        )}
      </section>

      {!locked && (
        <>
          <div className="wizard-nav">
            {stepIndex > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={nav.busy}
                onClick={() => void go(steps[stepIndex - 1].key, false)}
              >
                Back: {steps[stepIndex - 1].label}
              </Button>
            ) : (
              <span />
            )}
            {stepIndex < steps.length - 1 &&
              (nav.error || gateProblem(exam, steps[stepIndex].key, payer)) && (
                <p className="wizard-hint" role="status">
                  <Icon name="lock" size={14} />
                  {nav.error || gateProblem(exam, steps[stepIndex].key, payer)}
                </p>
              )}
            {stepIndex < steps.length - 1 && (
              <Button
                type="button"
                loading={nav.busy}
                disabled={gateProblem(exam, steps[stepIndex].key, payer) !== null}
                onClick={() => void go(steps[stepIndex + 1].key, true)}
              >
                Next: {steps[stepIndex + 1].label}
              </Button>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
