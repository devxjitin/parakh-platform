'use client';

import { QUESTION_TYPE_LABELS, planTotalMarks, type ExamDetailDto } from '@parakh/shared';
import { Icon } from './icons';

const KINDS = ['SINGLE', 'MULTI', 'SUBJECTIVE'] as const;
const planCount = (
  p: { singleCount: number; multiCount: number; subjectiveCount: number },
  k: (typeof KINDS)[number],
) => (k === 'SINGLE' ? p.singleCount : k === 'MULTI' ? p.multiCount : p.subjectiveCount);

/**
 * How far the paper is from its plan: a progress bar for the questions added so far and one chip
 * per question type. Replaces a long sentence of numbers.
 */
export function PlanProgress({ exam }: { exam: ExamDetailDto }) {
  const plan = exam.paperPlan;
  if (!plan) return null;

  const total = plan.totalQuestions;
  const added = exam.questionCount;
  const pct = total > 0 ? Math.min(100, Math.round((added / total) * 100)) : 0;
  const complete = added >= total;
  const byType = (k: (typeof KINDS)[number]) => exam.questions.filter((q) => q.type === k).length;

  return (
    <div className={`plan-progress${complete ? ' complete' : ''}`} role="status">
      <div className="pp-top">
        <div className="pp-count">
          <b>{added}</b>
          <span>/ {total} questions</span>
          {complete && (
            <em className="pp-done">
              <Icon name="check" size={13} /> All added
            </em>
          )}
        </div>
        <div className="pp-marks">
          <b>{exam.totalMarks}</b> / {planTotalMarks(plan)} marks
        </div>
      </div>
      <div
        className="pp-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={added}
        aria-label="Questions added"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="pp-chips">
        {KINDS.filter((k) => planCount(plan, k) > 0).map((k) => {
          const n = byType(k);
          const want = planCount(plan, k);
          return (
            <span key={k} className={`pp-chip${n >= want ? ' done' : ''}`}>
              {n >= want && <Icon name="check" size={12} />}
              {QUESTION_TYPE_LABELS[k]}
              <b>
                {n}/{want}
              </b>
            </span>
          );
        })}
      </div>
    </div>
  );
}
