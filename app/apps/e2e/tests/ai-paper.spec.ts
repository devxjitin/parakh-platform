import { expect, test } from '@playwright/test';
import { API, signIn, signUpByApi } from './helpers';

// A trainer builds a paper with an outside AI: describe it, copy the prompt, paste the JSON the AI
// returns, check it, and import it into the draft. (No AI is called; the answer is pasted.)
const trainer = { name: 'Ana Trainer', email: 'ana@e2e.test' };

const aiAnswer = JSON.stringify({
  schema: 'parakh.paper.v1',
  questions: [
    {
      type: 'SINGLE',
      topic: 'Networking',
      difficulty: 'MEDIUM',
      body: 'Which layer routes packets?',
      options: ['Data link', 'Network', 'Transport', 'Session'],
      correct: ['B'],
      explanation: 'Routing is layer 3.',
    },
    {
      type: 'SINGLE',
      topic: 'Networking',
      difficulty: 'MEDIUM',
      body: 'Which protocol resolves names to addresses?',
      options: ['DNS', 'ARP', 'DHCP', 'ICMP'],
      correct: ['A'],
    },
    {
      type: 'SINGLE',
      topic: 'Networking',
      difficulty: 'MEDIUM',
      body: 'Which port does HTTPS use by default?',
      options: ['80', '443', '22', '25'],
      correct: ['B'],
    },
  ],
});

test('build a paper with AI: prompt out, answer in, questions imported', async ({
  page,
  request,
}) => {
  const token = await signUpByApi(request, { ...trainer, role: 'EXAMINER' });
  const created = await request.post(`${API}/exams`, {
    data: {
      title: 'Networking Quiz',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 10_800_000).toISOString(),
      paperPlan: {
        totalQuestions: 3,
        singleCount: 3,
        multiCount: 0,
        subjectiveCount: 0,
        singleMarks: 2,
        multiMarks: 0,
        subjectiveMarks: 0,
      },
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();

  await signIn(page, trainer.email);
  await page.goto(`/exams/edit/?id=${id}`);
  await page.getByRole('button', { name: /Build with AI/ }).click();

  // The brief: the paper plan already says three single-answer questions; only the topic is left.
  await page.getByLabel('Subject or course').fill('Computer Networks');
  await page.getByLabel('Audience and level').fill('Second-year B.Tech, beginner');
  await page.getByRole('button', { name: '+ Add a topic' }).click();
  await page.getByLabel('Topic 1 name').fill('Networking');

  // Step 1: the prompt states the brief and the output rules.
  await page.getByRole('button', { name: 'Generate AI prompt' }).click();
  const dialog = page.getByRole('dialog', { name: '1. Copy the prompt' });
  await expect(dialog).toBeVisible();
  const prompt = await dialog.getByLabel('Prompt for the AI').inputValue();
  expect(prompt).toContain('Computer Networks');
  expect(prompt).toContain('Networking: 3 questions');
  expect(prompt).toContain('exactly 3 items');
  expect(prompt).toContain('Reply with one JSON object and nothing else');
  await expect(dialog.getByRole('link', { name: 'Open ChatGPT' })).toHaveAttribute(
    'href',
    'https://chatgpt.com/',
  );

  // Step 2: nothing can be imported before the answer is checked and the key is reviewed.
  await dialog.getByRole('button', { name: 'Next: paste the AI answer' }).click();
  await expect(page.getByRole('dialog', { name: '2. Paste the AI answer' })).toBeVisible();
  await page.getByLabel(/The AI answer/).fill('Here you go:\n```json\n' + aiAnswer + '\n```');
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText('Found 3 of 3 asked for.')).toBeVisible();
  await expect(page.getByText('B. Network (correct)')).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import 3 questions' });
  await expect(importButton).toBeDisabled();
  await page.getByLabel(/I have reviewed the answer key/).check();
  await importButton.click();

  // Back on the editor: the questions are in the draft.
  await expect(page.getByText(/Added 3 questions to the end of this exam/)).toBeVisible();
  // A draft shows the guided steps, not tabs: we are on the Questions step and the count is in the header.
  await expect(page.locator('.stepper-current')).toContainText('Questions');
  await expect(page.locator('.meta-chip', { hasText: '3 questions' })).toBeVisible();
  await expect(page.getByText('Which layer routes packets?')).toBeVisible();
});

test('a broken AI answer is explained and nothing is imported', async ({ page, request }) => {
  const token = await signUpByApi(request, {
    name: 'Bo Trainer',
    email: 'bo@e2e.test',
    role: 'EXAMINER',
  });
  const created = await request.post(`${API}/exams`, {
    data: {
      title: 'Second Quiz',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 10_800_000).toISOString(),
      paperPlan: {
        totalQuestions: 3,
        singleCount: 3,
        multiCount: 0,
        subjectiveCount: 0,
        singleMarks: 2,
        multiMarks: 0,
        subjectiveMarks: 0,
      },
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  const { id } = await created.json();

  await signIn(page, 'bo@e2e.test');
  await page.goto(`/exams/edit/?id=${id}`);
  await page.getByRole('button', { name: /Build with AI/ }).click();
  await page.getByLabel('Subject or course').fill('Maths');
  await page.getByLabel('Audience and level').fill('Class 10');
  await page.getByRole('button', { name: '+ Add a topic' }).click();
  await page.getByLabel('Topic 1 name').fill('Algebra');
  await page.getByRole('button', { name: 'Generate AI prompt' }).click();
  await page.getByRole('button', { name: 'Next: paste the AI answer' }).click();

  await page.getByLabel(/The AI answer/).fill(aiAnswer.slice(0, 140));
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByText(/The AI stopped early/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0);
});
