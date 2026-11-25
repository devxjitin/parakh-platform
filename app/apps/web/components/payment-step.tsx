'use client';

import { PRICING, type ExamDetailDto } from '@parakh/shared';
import { Alert, Req } from './ui';

export type PayerMode = 'STUDENTS' | 'TRAINER';

/** What the trainer chose on the Payment step. The charge itself happens when they publish. */
export interface PayerChoice {
  mode: PayerMode;
  emailText: string;
}

export const EMPTY_PAYER: PayerChoice = { mode: 'STUDENTS', emailText: '' };

export const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;

/** Unique, lower-cased student emails from free text, plus the ones that do not look valid. */
export function parseStudentEmails(text: string) {
  const emails = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
  return { emails, bad };
}

/** What publishing will cost, given the payer choice. */
export function payTotal(choice: PayerChoice) {
  const { emails } = parseStudentEmails(choice.emailText);
  return (
    PRICING.EXAM_CREATION_PAISE +
    (choice.mode === 'TRAINER' ? emails.length * PRICING.EXAM_JOIN_PAISE : 0)
  );
}

/** Payment step: who pays for the students' seats. Nothing is charged here. */
export function PaymentStep({
  exam,
  value,
  onChange,
}: {
  exam: ExamDetailDto;
  value: PayerChoice;
  onChange: (next: PayerChoice) => void;
}) {
  if (exam.nandivexHosted) {
    return (
      <div className="stack">
        <Alert kind="info">
          This is a NandiVex Technologies exam: <strong>no creation fee</strong>. Students pay{' '}
          <strong>
            {exam.studentFeePaise === 0 ? 'nothing (free)' : rupees(exam.studentFeePaise ?? 0)}
          </strong>{' '}
          to join. There is nothing to set up here, continue to Publish.
        </Alert>
      </div>
    );
  }

  const { emails, bad } = parseStudentEmails(value.emailText);
  const seatMode = value.mode === 'TRAINER';

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Choose who pays the student fee. You are only choosing here; the payment is taken in the
        next step, when you publish.
      </p>

      <div className="pay-options" role="radiogroup" aria-label="Who pays the student fee">
        <label className={`pay-option${!seatMode ? ' on' : ''}`}>
          <input
            type="radio"
            name="payer"
            checked={!seatMode}
            onChange={() => onChange({ ...value, mode: 'STUDENTS' })}
          />
          <span className="pay-option-text">
            <b>Students pay themselves</b>
            <small>
              Each student pays {rupees(PRICING.EXAM_JOIN_PAISE)} when they join with the exam code.
            </small>
          </span>
        </label>
        <label className={`pay-option${seatMode ? ' on' : ''}`}>
          <input
            type="radio"
            name="payer"
            checked={seatMode}
            onChange={() => onChange({ ...value, mode: 'TRAINER' })}
          />
          <span className="pay-option-text">
            <b>I will buy the seats</b>
            <small>
              You list your students, they join free, and only they can join. Students are not told
              who paid.
            </small>
          </span>
        </label>
      </div>

      {seatMode && (
        <div className="stack">
          <label className="field">
            <span>
              Student emails (one per line or separated by commas). One email = one seat.
              <Req />
            </span>
            <textarea
              rows={6}
              value={value.emailText}
              onChange={(e) => onChange({ ...value, emailText: e.target.value })}
              placeholder={'asha@example.com\nravi@example.com'}
            />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            When you publish, each student is emailed the exam code, the total marks, the timing and
            the join link. The list cannot be changed after publishing.
          </p>
          {bad.length > 0 && <Alert>Check these addresses: {bad.join(', ')}</Alert>}
        </div>
      )}

      <dl className="pay-summary">
        <div>
          <dt>Exam creation fee</dt>
          <dd>{rupees(PRICING.EXAM_CREATION_PAISE)}</dd>
        </div>
        {seatMode && (
          <div>
            <dt>
              Seats: {emails.length} × {rupees(PRICING.EXAM_JOIN_PAISE)}
            </dt>
            <dd>{rupees(emails.length * PRICING.EXAM_JOIN_PAISE)}</dd>
          </div>
        )}
        <div className="pay-total">
          <dt>Total to pay when you publish</dt>
          <dd>{rupees(payTotal(value))}</dd>
        </div>
      </dl>
      <p className="muted" style={{ margin: 0 }}>
        Prices are final; no GST is added. See the{' '}
        <a href="/refund-policy/" target="_blank" rel="noopener noreferrer">
          refund policy
        </a>
        .
      </p>
    </div>
  );
}
