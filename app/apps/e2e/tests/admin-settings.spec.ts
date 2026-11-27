import { expect, test } from '@playwright/test';
import { ADMIN, signIn } from './helpers';

// An admin can switch where people pay, any time. The choice is put back at the end so the rest of
// the suite keeps paying inside the app.
test('an admin switches payments between inside Parakh and the Razorpay page', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  const open = async () => {
    await page.goto('/admin/?tab=settings');
    await expect(page.getByText('Where people pay')).toBeVisible();
  };
  const save = async () => {
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved. New payments use these values.')).toBeVisible();
  };

  await open();
  // The server starts with in-app payments (Checkout).
  const inApp = page.getByRole('radio', { name: /Inside Parakh/ });
  const hosted = page.getByRole('radio', { name: /Razorpay page/ });
  await expect(inApp).toBeChecked();

  await hosted.check();
  await save();
  await open();
  await expect(hosted).toBeChecked();

  await inApp.check();
  await save();
  await open();
  await expect(inApp).toBeChecked();
});
