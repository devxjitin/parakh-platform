import { expect, test } from '@playwright/test';
import { API, emailedCode, openExam, signIn, signUpByApi } from './helpers';

// A trainer who buys the seats: publishing takes the creation fee and the seat fees, only the
// invited emails can join, and they join without paying.
test.describe.configure({ mode: 'serial' });

const trainer = { name: 'Sia Sponsor', email: 'sia@e2e.test', role: 'EXAMINER' as const };
const invited = { name: 'Ira Invited', email: 'ira@e2e.test' };
const outsider = { name: 'Omar Outsider', email: 'omar@e2e.test' };
let examId = '';
let examCode = '';

test('the trainer buys seats for one student and publishes', async ({ page, request }) => {
  const token = await signUpByApi(request, trainer);
  const headers = { Authorization: `Bearer ${token}` };
  const startsAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const created = await request.post(`${API}/exams`, {
    headers,
    data: {
      title: 'Sponsored Basics',
      durationMinutes: 30,
      startsAt,
      // The Payment and Publish steps open once the paper plan is saved.
      paperPlan: {
        totalQuestions: 1,
        singleCount: 1,
        multiCount: 0,
        subjectiveCount: 0,
        singleMarks: 2,
        multiMarks: 0,
        subjectiveMarks: 0,
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  examId = (await created.json()).id as string;
  const q = await request.post(`${API}/exams/${examId}/questions`, {
    headers,
    data: {
      type: 'SINGLE',
      body: 'What is IaaS?',
      options: ['Infrastructure', 'Internet'],
      correctOptions: [0],
      marks: 2,
    },
  });
  expect(q.ok()).toBeTruthy();

  await signIn(page, trainer.email);
  await page.goto(`/exams/edit/?id=${examId}`);
  await page.locator('.stepper-btn', { hasText: 'Payment' }).click();
  await page.getByText('I will buy the seats').click();
  await page.getByLabel(/Student emails/).fill(invited.email);
  await page.locator('.stepper-btn', { hasText: 'Publish' }).click();
  await page.getByRole('button', { name: /Pay .* and publish/ }).click();
  const code = page.getByText(/^NVX-[A-Z0-9]{6}$/);
  await expect(code).toBeVisible();
  examCode = (await code.textContent())!.trim();
  await expect(page.getByText(/You paid for 1 student seat/)).toBeVisible();
  openExam(examId);
});

test('the invited student joins for free', async ({ page }) => {
  await page.goto('/join/');
  await page.getByPlaceholder('NVX-XXXXXX').fill(examCode);
  await page.getByRole('button', { name: 'Find exam' }).click();
  await expect(page.getByText('Your trainer has paid for your seat.')).toBeVisible();
  await page.getByLabel(/Full name/).fill(invited.name);
  await page.getByLabel('Email').fill(invited.email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(await emailedCode(invited.email));
  await page.getByRole('button', { name: 'Verify code' }).click();
  // No payment step: the seat is free and the student goes straight in.
  await expect(page.getByText(/Pay .* and join/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Join for free' }).click();
  await page.waitForURL(/attempt/);
});

test('an email that was not invited cannot join', async ({ page }) => {
  await page.goto('/join/');
  await page.getByPlaceholder('NVX-XXXXXX').fill(examCode);
  await page.getByRole('button', { name: 'Find exam' }).click();
  await page.getByLabel(/Full name/).fill(outsider.name);
  await page.getByLabel('Email').fill(outsider.email);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send code' }).click();
  // The trainer chose who may join, so no code is sent to anyone else and nobody gets in.
  await expect(page.getByRole('alert').filter({ hasText: 'This exam is only for' })).toBeVisible();
  await expect(page).not.toHaveURL(/attempt/);
});
