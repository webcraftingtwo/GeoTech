import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // The suite shares one Postgres database; parallel files would interleave
    // truncations. Correctness over wall-clock here.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
