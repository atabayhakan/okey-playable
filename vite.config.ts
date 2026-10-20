import { defineConfig } from 'vite';

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
});
