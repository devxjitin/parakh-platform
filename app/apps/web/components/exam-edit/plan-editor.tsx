'use client';

import { type ExamDetailDto, type PaperPlan } from '@parakh/shared';
import { PaperPlanStep } from '../paper-plan-step';
import { PlanProgress } from '../plan-progress';
import { describeError } from '../ui';
import { api } from '../../lib/api';
import { type RegisterSave } from '../../lib/step-save';

/** Paper plan step: the plan (total, types, marks) and the schedule, editable until it is published. */
export function PlanEditor({
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
