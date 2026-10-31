import { defineConfig } from 'vitest/config';

// The tests that measure how long something takes: `npm test` runs them after the others, alone, one file at a
// time, so that nothing else on the machine is competing for it. The normal run (vite.config.ts) leaves them out.
export default defineConfig({
  test: {
    include: ['tests/timing/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
