'use client';

import { COPY } from '../../../lib/copy';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ExamDetailDto } from '@parakh/shared';
import { Icon } from '../../../components/icons';
import { ExamSettingsForm } from '../../../components/exam-settings-form';
import { ExtraTimePanel } from '../../../components/extra-time-panel';
import { ExamControls } from '../../../components/exam-controls';
import { PublishPanel } from '../../../components/publish-panel';
import { CertificatePanel } from '../../../components/certificate-panel';
import { ExamStepper } from '../../../components/exam-stepper';
import { EMPTY_PAYER, PaymentStep, type PayerChoice } from '../../../components/payment-step';
import { ResultsPanel } from '../../../components/results-panel';
import { Alert, Button, Shell, StatusBadge, useQueryParam } from '../../../components/ui';
import { ApiError, api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';
import { confirmDialog } from '../../../components/dialogs';
import { type RegisterSave, type StepSaver } from '../../../lib/step-save';
import { Tab, STEP_TO_TAB, TAB_TO_STEP } from '../../../components/exam-edit/tabs';
import { PlanEditor } from '../../../components/exam-edit/plan-editor';
import { stepsFor, gateProblem, furthestStep } from '../../../components/exam-edit/steps';
import { QuestionsTab } from '../../../components/exam-edit/questions-tab';
import { LogoTab } from '../../../components/exam-edit/logo-tab';

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
        <Link href="/exams/">{COPY.backToExams}</Link>
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
            {COPY.backToExams}
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
