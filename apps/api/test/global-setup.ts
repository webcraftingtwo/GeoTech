import { execSync } from 'node:child_process';

/** Applies the schema to the test database once per run. */
export default function setup() {
  const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://geotech@127.0.0.1:5432/geotech_test?schema=public';
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
