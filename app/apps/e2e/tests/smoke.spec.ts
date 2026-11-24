import { expect, test } from '@playwright/test';
import {
  ADMIN,
  API,
  PASSWORD,
  closeExam,
  emailedCode,
  signIn,
  signUpByApi,
  studentTokenByApi,
  tokenFor,
} from './helpers';

// One story, told in order: a trainer signs up, builds and publishes an exam, a student sits it on
// a phone, the trainer marks and publishes results, and the certificate is issued automatically.
test.describe.configure({ mode: 'serial' });

const trainer = { name: 'Tara Trainer', email: 'tara@e2e.test' };
const student = { name: 'Sam Student', email: 'sam@e2e.test' };
let examId = '';
let examCode = '';

test('register and verify an email', async ({ page }) => {
  await page.goto('/register/');
  await page.getByLabel('Full name').fill(trainer.name);
  await page.getByLabel('Email').fill(trainer.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.waitForURL(/verify-email/);
  await page.getByLabel('Verification code').fill(await emailedCode(trainer.email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await page.waitForURL(/dashboard/);
  await expect(page.getByRole('heading', { name: 'Recent exams' })).toBeVisible();
});

test('create an exam and publish it', async ({ page, request }) => {
  await signIn(page, trainer.email);
  await page.goto('/exams/new/');
  await page.getByLabel('Exam title').fill('Cloud Basics');
  // The New exam workflow: Basics creates the draft, then the guided steps carry on from there.
  await page.getByRole('button', { name: 'Next: add your logo' }).click();
  await page.waitForURL(/exams\/edit\/\?id=/);
  examId = new URL(page.url()).searchParams.get('id')!;
  await expect(page.locator('.stepper-current')).toContainText('Logo');

  // Paper plan: MCQ + subjective counts must add up to the total; the plan also holds the start time.
  await page.locator('.stepper-btn', { hasText: 'Paper plan' }).click();
  await page.getByLabel('Total number of questions').fill('3');
  // Pick the question types first; each one then gets its own count and marks.
  for (const type of ['MCQ (Single)', 'MCQ (Multiple)', 'Subjective']) {
    await page
      .getByRole('button', { name: new RegExp(`^${type.replace(/[()]/g, '\\$&')}`) })
      .click();
  }
  await page.getByLabel('MCQ (Single) questions').fill('1');
  await page.getByLabel('MCQ (Single) marks each').fill('2');
  await page.getByLabel('MCQ (Multiple) questions').fill('1');
  await page.getByLabel('MCQ (Multiple) marks each').fill('3');
  await page.getByLabel('Subjective questions').fill('1');
  await page.getByLabel('Subjective marks each').fill('5');
  await expect(page.getByRole('status', { name: 'Total marks' })).toContainText('10');
  // The exam closes by itself: start time plus duration (there is no closing time to enter).
  await page.getByRole('button', { name: 'Start date' }).click();
  await page
    .getByRole('dialog', { name: 'Pick a date' })
    .getByRole('button', { name: 'Today' })
    .click();
  await page.getByRole('button', { name: 'Start time' }).click();
  await page.getByRole('button', { name: 'Now' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  // Next saves the plan, then opens the Questions step.
  await page.getByRole('button', { name: 'Next: Questions' }).click();
  await expect(page.locator('.stepper-current')).toContainText('Questions');

  // Questions are set up through the API; the question editor is not what this test is about.
  const token = await tokenFor(request, trainer.email);
  const add = async (data: object) =>
    expect(
      (
        await request.post(`${API}/exams/${examId}/questions`, {
          data,
          headers: { Authorization: `Bearer ${token}` },
        })
      ).ok(),
    ).toBeTruthy();
  await add({
    type: 'SINGLE',
    body: 'What is IaaS?',
    options: ['Infrastructure', 'Internet', 'Integration', 'Island'],
    correctOptions: [0],
    marks: 2,
  });
  await add({
    type: 'MULTI',
    body: 'Pick public clouds',
    options: ['AWS', 'Azure', 'Excel'],
    correctOptions: [0, 1],
    marks: 3,
  });
  await add({ type: 'SUBJECTIVE', body: 'Explain shared responsibility', marks: 5 });

  await page.reload();
  // Payment step: students pay themselves (the default), then Publish takes the creation fee.
  await page.locator('.stepper-btn', { hasText: 'Payment' }).click();
  await expect(page.getByText('Students pay themselves')).toBeVisible();
  await page.locator('.stepper-btn', { hasText: 'Publish' }).click();
  await page.getByRole('button', { name: /Pay .* and publish/ }).click();
  const code = page.getByText(/^NVX-[A-Z0-9]{6}$/);
  await expect(code).toBeVisible();
  examCode = (await code.textContent())!.trim();
});

test('join with a code and an emailed code, take the exam on a phone and submit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });

  // No account: exam code, then name and email, then the code we email.
  await page.goto('/join/');
  await page.getByLabel('Exam code').fill(examCode);
  await page.getByRole('button', { name: 'Find exam' }).click();
  await page.getByLabel(/Full name/).fill(student.name);
  await page.getByLabel('Email').fill(student.email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('6-digit code').fill(await emailedCode(student.email));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: /Pay .* and join/ }).click();
  await expect(page.getByText('You are in')).toBeVisible();

  await page.getByRole('button', { name: 'Start exam' }).click();
  await page.waitForURL(/attempt/);
  await page.getByRole('button', { name: 'Begin exam' }).click();

  // The questions come in a random order, so answer whatever is on screen.
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.q-head-main', { hasText: `Question ${i + 1} of 3` })).toBeVisible();
    const written = page.getByPlaceholder('Type your response here...');
    if (await written.isVisible()) await written.fill('The provider secures the cloud.');
    else await page.locator('.attempt-opt-card').first().click();
    if (i < 2) await page.getByRole('button', { name: 'Next' }).click();
  }
  await expect(page.getByRole('status').filter({ hasText: 'All saved' })).toBeVisible();

  // The navigator is a bottom sheet on a phone, opened from the bottom bar.
  const sheet = page.locator('#question-navigator');
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: /^Questions 3\/3/ }).click();
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Question 1, answered' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.q-head-main', { hasText: 'Question 1 of 3' })).toBeVisible();

  // The submit dialog is a proper dialog: Escape closes it, and it opens again.
  await page.getByRole('button', { name: 'Submit exam' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Submit your exam?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Submit exam' }).last().click();
  await dialog.getByRole('button', { name: 'Yes, submit exam' }).click();
  await expect(page.getByRole('heading', { name: 'Exam submitted' })).toBeVisible();
});

test('mark the written answer and publish results', async ({ page }) => {
  closeExam(examId);
  await signIn(page, trainer.email);
  await page.goto(`/exams/edit/?id=${examId}`);
  await page.getByRole('tab', { name: 'Results' }).click();
  await page.getByRole('link', { name: 'Mark' }).click();
  await page.getByLabel(/Marks \(out of 5\)/).fill('4');
  await page.getByRole('button', { name: 'Save marks' }).click();
  await expect(page.getByRole('button', { name: 'Update marks' })).toBeVisible();

  await page.goto(`/exams/edit/?id=${examId}`);
  await page.getByRole('tab', { name: 'Results' }).click();
  await page.getByRole('button', { name: 'Publish results' }).click();
  // The confirmation is our own dialog, not the browser's.
  await page
    .getByRole('dialog', { name: 'Publish results' })
    .getByRole('button', { name: 'Publish', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Publish results' })).toBeHidden();
});

test('certificates are issued automatically, with no admin approval', async ({ page, request }) => {
  // Nobody approves anything: the student's certificate is already issued.
  // The link printed in the certificate's QR code opens the public check page, and it says genuine.
  const token = await studentTokenByApi(request, student);
  const mine = await request.get(`${API}/certificates/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const [cert] = await mine.json();
  expect(cert.serialNo).toMatch(/^PRK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await page.goto(cert.verifyUrl);
  await expect(page.getByText('This certificate is genuine')).toBeVisible();
  await expect(page.getByText(student.name)).toBeVisible();
});
