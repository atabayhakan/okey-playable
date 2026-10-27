import { defineConfig } from 'vitest/config';

// The benchmarks: `npm run bench:bots`. They print tables and assert nothing, and take minutes, so
// the normal test run (vite.config.ts) leaves bench/ out.
export default defineConfig({
  test: {
    include: ['bench/**/*.test.ts'],
    testTimeout: 3_600_000,
    reporters: ['verbose'],
  },
});
