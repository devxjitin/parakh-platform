import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:4000';
export const PASSWORD = 'CorrectHorse9battery';
export const ADMIN = { email: 'admin@e2e.test', password: 'AdminPass12345' };

const logPath = join(__dirname, '..', '.api.log');

/** The newest 6-digit sign-up code the API "emailed" to this address (it prints mail to its log). */
export async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const log = readFileSync(logPath, 'utf8');
    // Each logged email starts with the "[Mail]" tag; look at this address's emails newest first.
    const mails = log.split('[Mail]').filter((m) => m.includes(`To: ${email} |`));
    for (const mail of mails.reverse()) {
      const code = /code(?: is|:) (\d{6})/.exec(mail);
      if (code) return code[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No code was emailed to ${email}`);
}

/** Creates a verified account through the API (for setup, when the sign-up page is not the point). */
export async function signUpByApi(
  request: APIRequestContext,
  user: { name: string; email: string; role: 'EXAMINER' },
): Promise<string> {
  const reg = await request.post(`${API}/auth/register`, {
    data: { ...user, password: PASSWORD, acceptTerms: true },
  });
  expect(reg.ok()).toBeTruthy();
  const verified = await request.post(`${API}/auth/verify-email`, {
    data: { email: user.email, code: await emailedCode(user.email) },
  });
  expect(verified.ok()).toBeTruthy();
  return (await verified.json()).accessToken as string;
}

/**
 * A student has no password. After the exam is over they cannot join again, so the test takes a
 * sign-in token for them straight from the database and trades it for an access token.
 */
export async function studentTokenByApi(
  request: APIRequestContext,
  student: { email: string },
): Promise<string> {
  const refresh = execFileSync(
    'node',
    [join(__dirname, '..', 'scripts', 'db.mjs'), 'session-token', student.email],
    { encoding: 'utf8' },
  );
  const res = await request.post(`${API}/auth/refresh`, {
    headers: { Cookie: `prk_rt=${refresh}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

export async function tokenFor(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

export function closeExam(examId: string) {
  execFileSync('node', [join(__dirname, '..', 'scripts', 'db.mjs'), 'close-exam', examId], {
    stdio: 'inherit',
  });
}

/** "2026-11-23T09:30" in the browser's local time, which is what datetime-local inputs want. */
export function localInput(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
