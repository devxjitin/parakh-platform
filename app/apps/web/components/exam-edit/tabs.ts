export type Tab =
  'questions' | 'settings' | 'plan' | 'logo' | 'certificate' | 'payment' | 'publish' | 'results';

// Draft exams follow the guided paper workflow. Wizard step keys (see PAPER_STEPS) map onto tabs.
export const STEP_TO_TAB: Record<string, Tab> = {
  basics: 'settings',
  plan: 'plan',
  questions: 'questions',
  logo: 'logo',
  certificate: 'certificate',
  payment: 'payment',
  publish: 'publish',
};
export const TAB_TO_STEP: Record<string, string> = Object.fromEntries(
  Object.entries(STEP_TO_TAB).map(([step, tab]) => [tab, step]),
);
