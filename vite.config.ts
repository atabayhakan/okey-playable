import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

/** The web build is not inside YouTube: leave out the Playables SDK, it would only be a request to youtube.com. */
const withoutPlayablesSdk = (mode: string): Plugin => ({
  name: 'without-playables-sdk',
  transformIndexHtml: (html) =>
    mode === 'web' ? html.replace(/\s*<!--[^>]*Playables SDK[^>]*-->\s*<script src="https:\/\/www\.youtube\.com\/game_api\/v1"><\/script>/, '') : html,
});

export default defineConfig(({ mode }) => ({
  plugins: [withoutPlayablesSdk(mode)],
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
    // bench/ is run on its own with `npm run bench:bots`.
    exclude: [...configDefaults.exclude, 'bench/**'],
  },
}));
