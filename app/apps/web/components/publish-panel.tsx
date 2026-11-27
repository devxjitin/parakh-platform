'use client';

import { useState } from 'react';
import {
  PRICING,
  type ExamDetailDto,
  type PublishOrderDto,
  type PublishResultDto,
} from '@parakh/shared';
import { api } from '../lib/api';
import { runCheckout } from '../lib/checkout';
import { Icon } from './icons';
import { Alert, Button, describeError } from './ui';
import { parseStudentEmails, payTotal, rupees, type PayerChoice } from './payment-step';

type StrikePolicy = ExamDetailDto['strikePolicy'];

export function PublishPanel({
  exam,
  userName,
  userEmail,
  reload,
  payer,
  onEditPayment,
}: {
  exam: ExamDetailDto;
  userName: string;
  userEmail: string;
  reload: () => Promise<void>;
  /** The choice made on the Payment step. */
  payer?: PayerChoice;
  onEditPayment?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  const [shuffleQuestions, setShuffleQuestions] = useState(exam.shuffleQuestions);
  const [shuffleOptions, setShuffleOptions] = useState(exam.shuffleOptions);
  const [strikePolicy, setStrikePolicy] = useState<StrikePolicy>(exam.strikePolicy);
  const [maxStrikes, setMaxStrikes] = useState(String(exam.maxStrikes));
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleError, setRuleError] = useState('');
  const choice: PayerChoice = payer ?? { mode: 'STUDENTS', emailText: '' };
  const { emails: studentEmails, bad: badEmails } = parseStudentEmails(choice.emailText);
  const seatMode = choice.mode === 'TRAINER';
  const total = payTotal(choice);

  if (exam.code) {
    const link = `${window.location.origin}/join/?code=${exam.code}`;
    const copy = async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(what);
      } catch {
        setCopied('');
      }
    };
    return (
      <div className="pub">
        <section className="pub-done">
          <span className="pub-done-mark" aria-hidden="true">
            <Icon name="check" size={26} />
          </span>
          <div>
            <h3>Your exam is published</h3>
            <p>
              {exam.publishedAt
                ? `Published on ${new Date(exam.publishedAt).toLocaleString()}. `
                : ''}
              {exam.nandivexHosted ? '' : 'A receipt was emailed to you.'}
            </p>
          </div>
        </section>

        <section className="pub-code">
          <span className="pub-label">Exam code to share with students</span>
          <p className="pub-code-value">{exam.code}</p>
          <div className="pub-code-actions">
            <Button variant="secondary" onClick={() => copy(exam.code!, 'code')}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
            <Button variant="secondary" onClick={() => copy(link, 'link')}>
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </Button>
            <a
              className="btn btn-secondary btn-link"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://wa.me/?text=${encodeURIComponent(`Join my exam "${exam.title}" on Parakh. Code: ${exam.code}\n${link}`)}`}
            >
              Share on WhatsApp
            </a>
          </div>
        </section>

        {exam.alwaysOpen && (
          <p className="pub-note">
            <Icon name="info" size={16} />
            <span>
              This exam is on the Available exams list on the landing page and in the app. Retire it
              from Manage this exam to take it off.
            </span>
          </p>
        )}

        <p className="pub-note">
          <Icon name="info" size={16} />
          <span>
            {exam.sponsoredCount > 0
              ? `You paid for ${exam.sponsoredCount} student seat${exam.sponsoredCount === 1 ? '' : 's'}. Each invited student was emailed this code and a join link. Only those email addresses can join, and nobody else pays or gets in.`
              : 'Students will be able to join with this code once joining opens.'}
          </span>
        </p>
      </div>
    );
  }

  /** Saves just these settings straight away; the rest of the exam is left untouched. */
  async function saveRule(change: {
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    strikePolicy?: StrikePolicy;
    maxStrikes?: number;
  }) {
    const before = { shuffleQuestions, shuffleOptions, strikePolicy, maxStrikes };
    if (change.shuffleQuestions !== undefined) setShuffleQuestions(change.shuffleQuestions);
    if (change.shuffleOptions !== undefined) setShuffleOptions(change.shuffleOptions);
    if (change.strikePolicy !== undefined) setStrikePolicy(change.strikePolicy);
    if (change.maxStrikes !== undefined) setMaxStrikes(String(change.maxStrikes));
    setRuleError('');
    setRuleBusy(true);
    try {
      await api(`/exams/${exam.id}`, { method: 'PATCH', body: change });
      await reload();
    } catch (err) {
      setShuffleQuestions(before.shuffleQuestions);
      setShuffleOptions(before.shuffleOptions);
      setStrikePolicy(before.strikePolicy);
      setMaxStrikes(String(before.maxStrikes));
      setRuleError(describeError(err).message);
    } finally {
      setRuleBusy(false);
    }
  }

  function commitMaxStrikes() {
    const n = Number(maxStrikes);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      setRuleError('Warnings before automatic submit must be a whole number from 1 to 10.');
      setMaxStrikes(String(exam.maxStrikes));
      return;
    }
    if (n !== exam.maxStrikes) void saveRule({ maxStrikes: n });
  }

  const checks: [boolean, string][] = [
    [exam.questionCount > 0, 'At least one question'],
    // An always-open exam has no window to check.
    ...(exam.alwaysOpen
      ? []
      : ([
          [Boolean(exam.startsAt && exam.endsAt), 'The start time is set'],
          [
            Boolean(exam.startsAt && new Date(exam.startsAt) > new Date()),
            'The start time is still in the future',
          ],
          [
            Boolean(exam.endsAt && new Date(exam.endsAt) > new Date()),
            'The exam has not already ended (start time plus duration is in the future)',
          ],
        ] as [boolean, string][])),
  ];
  const ready = checks.every(([ok]) => ok);

  async function publishFree() {
    setError('');
    setBusy(true);
    try {
      await api(`/exams/${exam.id}/publish`, { method: 'POST' });
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setError('');
    setNote('');
    setBusy(true);
    try {
      const order = await api<PublishOrderDto>(`/exams/${exam.id}/publish-order`, {
        method: 'POST',
        body: seatMode ? { studentEmails } : {},
      });

      if (order.provider === 'fake') {
        setNote('Test mode: this payment is simulated and no money is charged.');
      }
      // Opens Razorpay's window here, or sends the payer to Razorpay's page and back, as the admin chose.
      const outcome = await runCheckout(order, { name: userName, email: userEmail });
      if (outcome.result) await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const STRIKE_OPTIONS: { key: StrikePolicy; title: string; text: string }[] = [
    {
      key: 'AUTO_SUBMIT',
      title: 'Auto-submit',
      text: 'Submit the exam automatically after the limit',
    },
    {
      key: 'WARN',
      title: 'Warn only',
      text: 'Warn the student and show you the count, never submit',
    },
    { key: 'OFF', title: 'Record only', text: 'Only record it for you, no warnings' },
  ];
  const payBlocked = seatMode && (studentEmails.length === 0 || badEmails.length > 0);

  return (
    <div className="pub">
      <header className="tool-head">
        <span className="tool-ico" aria-hidden="true">
          <Icon name="publish" size={20} />
        </span>
        <div>
          <h3>Publish your exam</h3>
          <p>
            Publishing creates your exam code. Once published, the questions and settings are
            locked.
          </p>
        </div>
      </header>

      <section className="qe-sec">
        <div className="qe-head">
          <h4>Before you publish</h4>
          <span className={`pub-state${ready ? ' ok' : ''}`}>
            {ready ? 'All set' : 'Needs attention'}
          </span>
        </div>
        <ul className="pub-checks">
          {checks.map(([ok, label]) => (
            <li key={label} className={ok ? 'ok' : 'bad'}>
              <span aria-hidden="true">
                <Icon name={ok ? 'check' : 'x'} size={14} />
              </span>
              {label}
            </li>
          ))}
        </ul>
        {exam.certificatesEnabled && !exam.hasLogo && (
          <p className="qe-note">
            Optional: add a logo in the Logo tab so it appears on your students&apos; certificates.
          </p>
        )}
      </section>

      <div className="pub-cols">
        <section className="qe-sec" aria-label="Shuffling">
          <div className="qe-head">
            <h4>Shuffling</h4>
          </div>
          <p className="qe-note">Decide before you publish: randomise what each student sees?</p>
          {ruleError && <Alert>{ruleError}</Alert>}
          <label className="pub-switch">
            <span>
              <b>Shuffle question order</b>
              <small>Each student gets the questions in a different order</small>
            </span>
            <span className="qe-switch">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                disabled={ruleBusy}
                onChange={(e) => saveRule({ shuffleQuestions: e.target.checked })}
              />
              <span className="qe-track" aria-hidden="true" />
            </span>
          </label>
          <label className="pub-switch">
            <span>
              <b>Shuffle answer options</b>
              <small>Options of choice questions appear in a different order</small>
            </span>
            <span className="qe-switch">
              <input
                type="checkbox"
                checked={shuffleOptions}
                disabled={ruleBusy}
                onChange={(e) => saveRule({ shuffleOptions: e.target.checked })}
              />
              <span className="qe-track" aria-hidden="true" />
            </span>
          </label>
        </section>

        <section className="qe-sec" aria-label="Security">
          <div className="qe-head">
            <h4>Security</h4>
          </div>
          <p className="qe-note">
            What happens when a student switches tabs or windows. Very short blurs, like a
            notification, are ignored. Phones that cannot go full screen are never penalised for
            that.
          </p>
          <div className="pub-policy" role="radiogroup" aria-label="Policy">
            {STRIKE_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={strikePolicy === o.key}
                disabled={ruleBusy}
                className={`pub-policy-opt${strikePolicy === o.key ? ' on' : ''}`}
                onClick={() => saveRule({ strikePolicy: o.key })}
              >
                <b>{o.title}</b>
                <small>{o.text}</small>
              </button>
            ))}
          </div>
          {strikePolicy === 'AUTO_SUBMIT' && (
            <label className="field pub-strikes">
              <span>Warnings before automatic submit (1 to 10)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={maxStrikes}
                disabled={ruleBusy}
                onChange={(e) => setMaxStrikes(e.target.value)}
                onBlur={commitMaxStrikes}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
          )}
        </section>
      </div>

      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="info">{note}</Alert>}

      {exam.nandivexHosted ? (
        <section className="pub-pay">
          <div className="pub-pay-info">
            <span className="pub-label">NandiVex Technologies exam</span>
            <p>
              <b>No creation fee.</b> Students pay{' '}
              <b>
                {exam.studentFeePaise === 0 ? 'nothing (free)' : rupees(exam.studentFeePaise ?? 0)}
              </b>{' '}
              to join.
            </p>
          </div>
          <Button disabled={!ready} loading={busy} onClick={publishFree}>
            Publish exam
          </Button>
        </section>
      ) : (
        <section className="pub-pay">
          <div className="pub-pay-info">
            <div className="pub-recap">
              <span className="pub-recap-ico" aria-hidden="true">
                <Icon name={seatMode ? 'users' : 'card'} size={18} />
              </span>
              <div>
                <b>{seatMode ? 'You buy the seats' : 'Students pay themselves'}</b>
                <small>
                  {seatMode
                    ? `${studentEmails.length} seat${studentEmails.length === 1 ? '' : 's'} for the listed students. They join free.`
                    : `Each student pays ${rupees(PRICING.EXAM_JOIN_PAISE)} when they join.`}
                </small>
              </div>
              {onEditPayment && (
                <Button type="button" variant="secondary" small onClick={onEditPayment}>
                  Change
                </Button>
              )}
            </div>
            <dl className="pub-fees">
              <div>
                <dt>
                  Exam creation fee <small>(final price, no GST added)</small>
                </dt>
                <dd>{rupees(PRICING.EXAM_CREATION_PAISE)}</dd>
              </div>
              {seatMode && (
                <div>
                  <dt>
                    Seats for {studentEmails.length} student{studentEmails.length === 1 ? '' : 's'}
                  </dt>
                  <dd>{rupees(Math.max(0, total - PRICING.EXAM_CREATION_PAISE))}</dd>
                </div>
              )}
              <div className="pub-fees-total">
                <dt>Total</dt>
                <dd>{rupees(total)}</dd>
              </div>
            </dl>
            {payBlocked && (
              <Alert>
                {studentEmails.length === 0
                  ? 'You chose to buy seats but listed no students. Go back to Payment and add their emails.'
                  : `Check these addresses on the Payment step: ${badEmails.join(', ')}`}
              </Alert>
            )}
          </div>
          <div className="pub-pay-go">
            <Button disabled={!ready || payBlocked} loading={busy} onClick={pay}>
              Pay {rupees(total)} and publish
            </Button>
            <small>
              See the{' '}
              <a href="/refund-policy/" target="_blank" rel="noopener noreferrer">
                refund policy
              </a>
              .
            </small>
          </div>
        </section>
      )}
    </div>
  );
}
