import type { Answer, Attempt, Exam, Question } from '@prisma/client';
import type { StudentResultDto } from '@parakh/shared';

/** The per-question result a student sees (and the answer sheet prints), from a published attempt. */
export function toStudentResult(
  attempt: Attempt & { answers: Answer[]; exam: Exam & { questions: Question[] } },
): StudentResultDto {
  const byQuestion = new Map(attempt.answers.map((a) => [a.questionId, a]));
  const byId = new Map(attempt.exam.questions.map((q) => [q.id, q]));
  const order = attempt.questionOrder as string[];
  return {
    attemptId: attempt.id,
    examTitle: attempt.exam.title,
    passPercent: attempt.exam.passPercent,
    score: attempt.score ?? 0,
    maxScore: attempt.maxScore ?? 0,
    percent: attempt.percent ?? 0,
    passed: Boolean(attempt.passed),
    questions: order.flatMap((id, i) => {
      const q = byId.get(id);
      if (!q) return [];
      const a = byQuestion.get(id);
      return [
        {
          questionId: q.id,
          number: i + 1,
          type: q.type,
          body: q.body,
          markdown: q.markdown,
          imageAlt: q.imageAlt,
          options: q.options,
          correctOptions: q.correctOptions,
          selected: a?.selected ?? [],
          text: a?.text ?? null,
          marks: q.marks,
          marksAwarded: a?.marksAwarded ?? 0,
          explanation: q.explanation,
          feedback: a?.feedback ?? null,
        },
      ];
    }),
  };
}
