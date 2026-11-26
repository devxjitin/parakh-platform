import { expect, test } from '@playwright/test';
import { ADMIN, API, signIn, tokenFor } from './helpers';

// Continues the story in smoke.spec.ts: the trainer's exam results are published, so her share of
// the student's fee is payable. She adds payout details, asks for a payout, and an admin pays it.
test.describe.configure({ mode: 'serial' });

const trainer = { email: 'tara@e2e.test' };
const UTR = '402198765432';

test('the trainer adds payout details and asks for a payout', async ({ page, request }) => {
  // The platform minimum is INR 500; a single student's share is far below it, so lower it.
  const admin = await tokenFor(request, ADMIN.email, ADMIN.password);
  const headers = { Authorization: `Bearer ${admin}` };
  const current = await (await request.get(`${API}/admin/settings`, { headers })).json();
  const saved = await request.put(`${API}/admin/settings`, {
    headers,
    data: { ...current, minPayoutPaise: 100 },
  });
  expect(saved.ok()).toBeTruthy();

  await signIn(page, trainer.email);
  await page.goto('/earnings/');
  await expect(page.getByText('Payable now')).toBeVisible();

  await page.getByText('UPI', { exact: true }).click();
  await page.getByPlaceholder('name@bank').fill('tara@okbank');
  await page.getByRole('button', { name: 'Save payout details' }).click();
  await expect(page.getByText('waiting for NandiVex Technologies to verify')).toBeVisible();

  await page.getByRole('button', { name: /^Request payout of/ }).click();
  await expect(page.getByText('requested', { exact: false }).first()).toBeVisible();
});

test('an admin verifies the details and marks the payout paid', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/payouts/');

  const row = page.getByRole('row', { name: /tara@e2e\.test/ });
  await expect(row).toBeVisible();
  // Money cannot be sent to details nobody has checked.
  await expect(row.getByRole('button', { name: 'Mark paid' })).toBeDisabled();
  await row.getByRole('button', { name: 'Mark details verified' }).click();
  await expect(row.getByText('Verified')).toBeVisible();

  await row.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByPlaceholder('e.g. 4012345678').fill(UTR);
  await page.getByRole('button', { name: /^Mark as paid/ }).click();

  await expect(page.getByText('Nobody is owed money right now.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Paid', exact: true }).first()).toBeVisible();
});

test('the trainer sees the payout as paid', async ({ page }) => {
  await signIn(page, trainer.email);
  await page.goto('/earnings/');
  await expect(page.getByText('Paid to you')).toBeVisible();
  await expect(page.getByText('paid', { exact: false }).first()).toBeVisible();
});
