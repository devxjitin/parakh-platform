import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // The tests share one database and follow one story (sign up, build an exam, sit it, certify).
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/start-api.mjs',
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node scripts/serve-web.mjs',
      url: 'http://localhost:3000/',
      reuseExistingServer: false,
    },
  ],
});
