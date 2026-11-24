// Starts the real API for the browser tests on a fresh database and writes its log to .api.log
// (the mail transport is "log", so the sign-up codes appear there and the tests read them).
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const api = join(root, 'apps', 'api');
const logPath = join(here, '..', '.api.log');
const dbUrlPath = join(here, '..', '.db-url');

// Every run gets its own empty database, so there is nothing to reset or delete.
const base = process.env.E2E_DATABASE_URL ?? 'postgresql://parakh:parakh@localhost:5432/postgres';
const dbName = `parakh_e2e_${Date.now()}`;
const databaseUrl = new URL(base);
databaseUrl.pathname = `/${dbName}`;
const { PrismaClient } = createRequire(join(api, 'package.json'))('@prisma/client');
const admin = new PrismaClient({ datasources: { db: { url: base } } });
await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
await admin.$disconnect();
writeFileSync(dbUrlPath, databaseUrl.toString());

export const ADMIN = { email: 'admin@e2e.test', password: 'AdminPass12345' };

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: databaseUrl.toString(),
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef0123',
  OTP_SECRET: 'e2e-otp-secret-0123456789abcdef012345',
  WEB_ORIGIN: 'http://localhost:3000',
  MAIL_TRANSPORT: 'log',
  PAYMENT_PROVIDER: 'fake',
  STORAGE_DRIVER: 'memory',
  CERT_JOBS_POLL: 'on',
  ADMIN_EMAIL: ADMIN.email,
  ADMIN_PASSWORD: ADMIN.password,
  ADMIN_NAME: 'E2E Admin',
};

const run = (args) => {
  const r = spawnSync('npx', args, { cwd: api, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['prisma', 'migrate', 'deploy']);
const seed = spawnSync('node', ['dist/scripts/seed-admin.js'], { cwd: api, env, stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);

const log = createWriteStream(logPath);
const child = spawn('node', ['dist/main.js'], { cwd: api, env });
child.stdout.pipe(log);
child.stderr.pipe(log);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
