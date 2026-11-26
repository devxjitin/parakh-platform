'use client';

import Link from 'next/link';
import type { AttemptDto } from '@parakh/shared';
import { Icon } from '../icons';
import { END_TEXT } from './helpers';

/** Shown after the exam ends: what was saved and what happens next. */
export function AttemptEnded({ attempt }: { attempt: AttemptDto }) {
  const steps = [
    {
      icon: 'check' as const,
      title: 'Answers saved',
      text: 'Everything you answered is stored. You can close this page.',
    },
    {
      icon: 'mail' as const,
      title: 'Result by email',
      text: 'Your score, answer key and certificate are emailed as soon as marking is complete: right away for choice-only exams, after your trainer marks written answers otherwise.',
    },
    {
      icon: 'book' as const,
      title: 'Practice code',
      text: 'A practice code for the same questions follows after the exam closes.',
    },
  ];
  return (
    <main className="gate gate-start gate-done">
      <section className="wr-hero gate-hero">
        <span className="done-mark" aria-hidden="true">
          <Icon name="check" size={30} />
        </span>
        <h1 className="wr-title">Exam submitted</h1>
        <p className="wr-by">{attempt.exam.title}</p>
        <p className="gate-lead">
          {END_TEXT[attempt.endReason ?? ''] ?? 'Your exam has been submitted.'}
        </p>
        <div className="gate-info">
          <div className="gate-info-card">
            <h3>Exam</h3>
            <dl>
              <div>
                <dt>Questions</dt>
                <dd>{attempt.exam.questionCount}</dd>
              </div>
              <div>
                <dt>Total marks</dt>
                <dd>{attempt.exam.totalMarks}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{attempt.exam.durationMinutes} min</dd>
              </div>
              {attempt.exam.code && (
                <div>
                  <dt>Exam code</dt>
                  <dd>{attempt.exam.code}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="gate-info-card">
            <h3>Candidate</h3>
            <div className="gate-student">
              <span className="gate-avatar" aria-hidden="true">
                {attempt.student.name.trim().charAt(0).toUpperCase() || 'S'}
              </span>
              <div>
                <b>{attempt.student.name}</b>
                <span>{attempt.student.email}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      <aside className="gate-side">
        <div className="wr-panel">
          <h3>What happens next</h3>
          <ol className="next-steps">
            {steps.map((st) => (
              <li key={st.title}>
                <span className="next-ico" aria-hidden="true">
                  <Icon name={st.icon} size={18} />
                </span>
                <div>
                  <b>{st.title}</b>
                  <p>{st.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link href="/" className="btn btn-primary btn-link done-home">
            Go to home page
          </Link>
        </div>
      </aside>
    </main>
  );
}
