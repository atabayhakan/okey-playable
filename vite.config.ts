import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { pwa } from './scripts/pwa-plugin.mjs';

/** The web build is not inside YouTube: leave out the Playables SDK, it would only be a request to youtube.com. */
const withoutPlayablesSdk = (mode: string): Plugin => ({
  name: 'without-playables-sdk',
  transformIndexHtml: (html) =>
    mode === 'web' ? html.replace(/\s*<!--[^>]*Playables SDK[^>]*-->\s*<script src="https:\/\/www\.youtube\.com\/game_api\/v1"><\/script>/, '') : html,
});

export default defineConfig(({ mode }) => ({
  // The web build is also an installable app that works offline; the Playables build is not (see scripts/pwa-plugin.mjs).
  plugins: [withoutPlayablesSdk(mode), pwa(mode)],
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
    // The bot tests play whole hands, and the hard bot searches a lot: on a loaded machine (or a CI
    // runner) the default five seconds is far too little, and thirty was not enough either.
    testTimeout: 120_000,
    // bench/ is run on its own with `npm run bench:bots`, and the timing tests alone after the rest (`npm test`).
    exclude: [...configDefaults.exclude, 'bench/**', 'tests/timing/**'],
  },
}));
