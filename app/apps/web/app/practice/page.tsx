'use client';

import { QuestionImage, QuestionText } from '../../components/question-content';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AuthResponse,
  type PracticeFeedbackDto,
  type PracticeQuestionDto,
  type PracticeRoundDto,
  type PracticeSetDto,
  type PracticeSummaryDto,
} from '@parakh/shared';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatusBadge,
  describeError,
  useQueryParam,
} from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const letter = (i: number) => String.fromCharCode(65 + i);
const when = (iso: string) => new Date(iso).toLocaleString();
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** The practice code from the "exam closed" email stands in for a sign-in. */
function CodeEntry({ initial }: { initial: string }) {
  const { setSession } = useAuth();
  const [code, setCode] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const open = useCallback(
    async (value: string) => {
      setError('');
      setBusy(true);
      try {
        setSession(
          await api<AuthResponse>('/auth/practice', {
            method: 'POST',
            auth: false,
            body: { code: value },
          }),
        );
      } catch (err) {
        setError(describeError(err).message);
      } finally {
        setBusy(false);
      }
    },
    [setSession],
  );

  useEffect(() => {
    if (initial && !tried.current) {
      tried.current = true;
      setCode(initial);
      void open(initial);
    }
  }, [initial, open]);

  return (
    <Shell>
      <PageHeader
        title="Practice"
        subtitle="Enter the practice code we emailed you after your exam closed. Practice is free, has no certificate and does not change your score."
      />
      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void open(code);
          }}
        >
          <label className="field">
            <span>Practice code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PRC-XXXXXX"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={busy} disabled={!code.trim()}>
            Open practice
          </Button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          No code yet? It is emailed once the exam has closed, to students who took it.
        </p>
      </section>
    </Shell>
  );
}

export default function PracticePage() {
  const { user, loading } = useAuth();
  const examId = useQueryParam('exam');
  const queryCode = useQueryParam('code');

  if (loading) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (!user) return <CodeEntry initial={queryCode} />;
  if (user.role !== 'STUDENT') {
    return (
      <Shell wide>
        <Alert>Practice sets are for students.</Alert>
      </Shell>
    );
  }
  return <Shell wide>{examId ? <PracticeSet examId={examId} /> : <PracticeList />}</Shell>;
}

// ---------------------------------------------------------------------- the list

function PracticeList() {
  const [items, setItems] = useState<PracticeSummaryDto[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<PracticeSummaryDto[]>('/practice')
      .then(setItems)
      .catch((e) => setError(describeError(e).message));
  }, []);

  return (
    <>
      <PageHeader title="Practice" subtitle="Practise the questions of exams you have taken" />
      {error && <Alert>{error}</Alert>}
      {items === null && !error && <p className="muted">Loading…</p>}
      {items?.length === 0 && (
        <Alert kind="info">
          A practice set opens here after an exam you took has closed. Practice never changes your
          official score.
        </Alert>
      )}
      <div className="stack">
        {items?.map((p) => (
          <section className="card" key={p.examId}>
            <div className="toolbar">
              <div>
                <strong>{p.title}</strong>
                <div className="muted">
                  {p.trainerName}, {p.questionCount} questions, open until {day(p.expiresAt)}
                </div>
              </div>
              <span className="spacer" />
              {p.rounds > 0 ? (
                <StatusBadge
                  status="LIVE"
                  label={`${p.rounds} round${p.rounds === 1 ? '' : 's'}, best ${p.bestPercent}%`}
                />
              ) : (
                <StatusBadge status="PUBLISHED" label="Not started" />
              )}
              <a className="btn btn-primary btn-link" href={`/practice/?exam=${p.examId}`}>
                {p.rounds > 0 ? 'Practise again' : 'Start practising'}
              </a>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------- one set

type Draft = { selected: number[]; text: string };

function PracticeSet({ examId }: { examId: string }) {
  const [set, setSet] = useState<PracticeSetDto | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [feedback, setFeedback] = useState<Record<string, PracticeFeedbackDto>>({});
  const [round, setRound] = useState<PracticeRoundDto | null>(null);
  const [history, setHistory] = useState<PracticeRoundDto[]>([]);
  const [finishing, setFinishing] = useState(false);

  const loadHistory = () =>
    api<PracticeRoundDto[]>(`/practice/${examId}/rounds`)
      .then(setHistory)
      .catch(() => undefined);

  useEffect(() => {
    api<PracticeSetDto>(`/practice/${examId}`)
      .then((s) => {
        setSet(s);
        void loadHistory();
      })
      .catch((e) =>
        setError(e instanceof ApiError && e.status === 403 ? e.message : describeError(e).message),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  const draftOf = (q: PracticeQuestionDto): Draft => drafts[q.id] ?? { selected: [], text: '' };
  const setDraft = (q: PracticeQuestionDto, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [q.id]: { ...draftOf(q), ...patch } }));
    // An edited answer needs a fresh check.
    setFeedback((f) => {
      if (!f[q.id]) return f;
      const rest = { ...f };
      delete rest[q.id];
      return rest;
    });
  };

  async function finish() {
    if (!set) return;
    setFinishing(true);
    setError('');
    try {
      const answers: Record<string, number[]> = {};
      for (const q of set.questions) {
        if (q.type === 'SINGLE' || q.type === 'MULTI') answers[q.id] = draftOf(q).selected;
      }
      setRound(
        await api<PracticeRoundDto>(`/practice/${examId}/rounds`, {
          method: 'POST',
          body: { answers },
        }),
      );
      await loadHistory();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setFinishing(false);
    }
  }

  function again() {
    setRound(null);
    setDrafts({});
    setFeedback({});
    window.scrollTo({ top: 0 });
  }

  if (!set) {
    return (
      <>
        {error ? <Alert kind="info">{error}</Alert> : <p className="muted">Loading…</p>}
        <p>
          <a href="/practice/">Back to practice</a>
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={set.title}
        subtitle={`Practice set, open until ${day(set.expiresAt)}. It does not affect your official result.`}
      >
        <a className="btn btn-secondary btn-link" href="/practice/">
          All practice sets
        </a>
      </PageHeader>
      {error && <Alert>{error}</Alert>}

      {round && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2 style={{ marginTop: 0 }}>
            Round score: {round.score} / {round.maxScore} ({round.percent}%)
          </h2>
          <p className="muted">
            {round.answered} of {round.scoredCount} choice questions answered. Check written answers
            for feedback.
          </p>
          <Button onClick={again}>Start a new round</Button>
        </section>
      )}

      {set.questions.map((q) => (
        <QuestionCard
          key={q.id}
          examId={examId}
          q={q}
          draft={draftOf(q)}
          feedback={feedback[q.id]}
          onDraft={(p) => setDraft(q, p)}
          onFeedback={(f) => setFeedback((m) => ({ ...m, [q.id]: f }))}
        />
      ))}

      <div className="toolbar" style={{ margin: '16px 0' }}>
        <Button loading={finishing} onClick={finish}>
          Finish round and see my score
        </Button>
      </div>

      {history.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Your practice history</h2>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Score</th>
                <th>Answered</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.createdAt)}</td>
                  <td>
                    {r.score} / {r.maxScore} ({r.percent}%)
                  </td>
                  <td>
                    {r.answered} / {r.scoredCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function QuestionCard({
  examId,
  q,
  draft,
  feedback,
  onDraft,
  onFeedback,
}: {
  examId: string;
  q: PracticeQuestionDto;
  draft: Draft;
  feedback?: PracticeFeedbackDto;
  onDraft: (p: Partial<Draft>) => void;
  onFeedback: (f: PracticeFeedbackDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choice = q.type === 'SINGLE' || q.type === 'MULTI';

  async function check() {
    setBusy(true);
    setError('');
    try {
      onFeedback(
        await api<PracticeFeedbackDto>(`/practice/${examId}/questions/${q.id}/check`, {
          method: 'POST',
          body: choice ? { selected: draft.selected } : { text: draft.text },
        }),
      );
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <div className="toolbar">
        <strong>Question {q.number}</strong>
        <span className="spacer" />
        <span className="muted">{q.marks} marks</span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>
        <QuestionText text={q.body} markdown={q.markdown} />
      </p>
      {q.imageAlt && (
        <QuestionImage path={`/practice/${examId}/questions/${q.id}/image`} alt={q.imageAlt} />
      )}

      {choice && (
        <div className="stack">
          {q.type === 'MULTI' && <small className="muted">Select all that apply.</small>}
          {q.options.map((o, i) => {
            const on = draft.selected.includes(i);
            const right = feedback?.correctOptions.includes(i);
            const cls = feedback ? (right ? 'correct' : on ? 'wrong' : '') : '';
            return (
              <label
                className={`check q-item ${cls ? `q-pick ${cls}` : ''}`}
                key={i}
                style={{ cursor: 'pointer' }}
              >
                <input
                  type={q.type === 'SINGLE' ? 'radio' : 'checkbox'}
                  name={q.id}
                  checked={on}
                  onChange={() =>
                    onDraft({
                      selected:
                        q.type === 'SINGLE'
                          ? [i]
                          : on
                            ? draft.selected.filter((x) => x !== i)
                            : [...draft.selected, i],
                    })
                  }
                />{' '}
                <span>
                  {letter(i)}. <QuestionText text={o} markdown={q.markdown} />
                </span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === 'SUBJECTIVE' && (
        <textarea
          value={draft.text}
          onChange={(e) => onDraft({ text: e.target.value })}
          placeholder="Write your answer here, then check what a good answer covers"
          style={{ width: '100%', minHeight: 140, font: 'inherit', padding: 10 }}
          maxLength={20000}
        />
      )}

      <div className="toolbar" style={{ marginTop: 10 }}>
        <Button variant="secondary" loading={busy} onClick={check}>
          {choice ? 'Check answer' : 'Show what a good answer covers'}
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {feedback && <Feedback f={feedback} markdown={q.markdown} />}
    </section>
  );
}

function Feedback({ f, markdown }: { f: PracticeFeedbackDto; markdown: boolean }) {
  return (
    <div className="stack" style={{ marginTop: 10 }}>
      {f.correct === true && <Alert kind="success">Correct! +{f.marks} marks.</Alert>}
      {f.correct === false && (
        <Alert>
          {f.marks && f.marks > 0
            ? `Partly right: ${f.marks} of ${f.maxMarks} marks.`
            : 'Not quite.'}{' '}
          {f.correctOptions.length > 0 && (
            <>Correct answer: {f.correctOptions.map(letter).join(', ')}.</>
          )}
        </Alert>
      )}
      {f.guidance && (
        <Alert kind="info">
          <strong>A good answer covers:</strong>{' '}
          <QuestionText text={f.guidance} markdown={markdown} />
        </Alert>
      )}
      {f.type === 'SUBJECTIVE' && !f.guidance && !f.explanation && (
        <Alert kind="info">There is no model answer for this question.</Alert>
      )}
      {f.explanation && (
        <p className="muted" style={{ margin: 0 }}>
          <strong>Explanation:</strong> <QuestionText text={f.explanation} markdown={markdown} />
        </p>
      )}
    </div>
  );
}
