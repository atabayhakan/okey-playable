// Makes the web build installable and playable offline: a web app manifest, the icons and a service worker that
// keeps every file of the build. It is a Vite plugin for `--mode web` only. The Playables build gets none of it:
// a Playables game must not register a service worker, and check-bundle.mjs fails the build if it has one.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The felt, as the page and the launcher's bar are coloured. */
export const THEME_COLOR = '#14402e';
export const BACKGROUND_COLOR = '#0a2318';

/** The app icons: the 512 px one is also the maskable one (the tiles stay in the middle 68% of it). */
const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

/** The web app manifest. Every path is relative to the manifest, so the app works from any folder (GitHub Pages, itch.io). */
export function manifest() {
  return {
    id: './',
    name: 'Okey',
    short_name: 'Okey',
    description: 'Okey, the tile game, against three computer players. Plays offline.',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: ['games'],
    icons: [
      ...ICONS.map(({ file, size }) => ({ src: `icons/${file}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/**
 * The service worker. It keeps every file of the build when it installs, answers from that and falls back to the
 * network for anything else, and drops the files of an older build when it takes over. `files` are paths relative
 * to the worker; `version` changes with the content, so a new build is a new worker.
 */
export function serviceWorkerSource(version, files) {
  return `// Okey service worker, build ${version}. Generated: do not edit.
const CACHE = 'okey-${version}';
const FILES = ${JSON.stringify(files, null, 2)};

self.addEventListener('install', (event) => {
  // 'reload' goes to the network, not to whatever the browser cached: the files kept have to be this build's.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('okey-') && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // ignoreSearch: the game is opened as ./?lang=de as well as ./
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((kept) => {
      if (kept) return kept;
      return fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
`;
}

/** The files of a build, as paths relative to its folder with forward slashes, in a fixed order. */
function filesOf(dir) {
  const found = [];
  (function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).replaceAll('\\', '/'));
    }
  })(dir);
  return found.filter((f) => f !== 'sw.js').sort();
}

/** The paths the worker keeps: the page under both its names, then every file of the build. */
export function precacheList(files) {
  return ['./', ...files.map((f) => `./${f}`)];
}

/** A short fingerprint of the content of the build: the same files give the same version. */
export function versionOf(dir, files) {
  const hash = createHash('sha1');
  for (const file of files) hash.update(file).update(readFileSync(join(dir, file)));
  return hash.digest('hex').slice(0, 10);
}

export function pwa(mode) {
  let outDir = '';
  return {
    name: 'okey-pwa',
    apply: (_config, { command }) => mode === 'web' && command === 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: THEME_COLOR }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: './icons/icon-192.png' }, injectTo: 'head' },
      // The tab's icon, so that no browser asks for /favicon.ico (which a worker could not answer when offline).
      { tag: 'link', attrs: { rel: 'icon', type: 'image/png', href: './icons/icon-192.png' }, injectTo: 'head' },
    ],
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest(), null, 2) });
      for (const { file } of ICONS) this.emitFile({ type: 'asset', fileName: `icons/${file}`, source: readFileSync(join(root, 'src', 'pwa', file)) });
    },
    // The worker is written when everything else is: it lists the files that are there.
    closeBundle() {
      const files = filesOf(outDir);
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource(versionOf(outDir, files), precacheList(files)));
    },
  };
}
