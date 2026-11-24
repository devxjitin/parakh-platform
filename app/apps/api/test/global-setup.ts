import { execSync } from 'node:child_process';

/** Applies all migrations to the test database once before the test run. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgresql://parakh:parakh@localhost:5432/parakh_test';
  // Safety: never run migrations or truncations against a database that is not clearly a test one.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error('Refusing to run tests: the database name must contain "test"');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
