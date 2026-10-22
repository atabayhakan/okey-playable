import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Playables are served from a path YouTube chooses, so every asset URL must be relative.
  base: './',
  server: { port: 5180, strictPort: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    // Default minifier. Minification is allowed by the review; obfuscation is not.
    modulePreload: { polyfill: false },
  },
  test: {
    // The bot tests play hundreds of hands; on a loaded machine the default
    // five seconds is not enough.
    testTimeout: 30_000,
  },
});
