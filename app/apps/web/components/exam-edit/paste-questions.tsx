'use client';

import { useState } from 'react';
import { type ExamDetailDto } from '@parakh/shared';
import { Icon } from '../icons';
import { ImportPreview } from '../import-preview';
import { Alert, Button, describeError } from '../ui';
import { ApiError, api } from '../../lib/api';
import { ImportResult } from './questions-tab';

export function PasteQuestions({
  exam,
  reload,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
}) {
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
