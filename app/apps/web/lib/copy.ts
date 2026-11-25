/**
 * Names of the buttons and links that appear on more than one page. One action keeps one name
 * everywhere; change it here and every page follows.
 */
export const COPY = {
  sendCode: 'Send code',
  resendCode: 'Resend code',
  verifyCode: 'Verify code',
  createTrainerAccount: 'Create trainer account',
  backToExams: 'Back to exams',
  markAsPaid: 'Mark as paid',
  markDetailsVerified: 'Mark details verified',
  markAnswers: 'Mark answers',
  deleteAccount: 'Delete my account',
  payments: 'Payments',
} as const;

/** "Resend code in 12s" while the wait lasts, otherwise "Resend code". */
export const resendLabel = (secondsLeft: number) =>
  secondsLeft > 0 ? `${COPY.resendCode} in ${secondsLeft}s` : COPY.resendCode;
