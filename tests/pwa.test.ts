import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_COLOR, THEME_COLOR, manifest, precacheList, serviceWorkerSource } from '../scripts/pwa-plugin.mjs';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');

describe('the web app manifest', () => {
  const m = manifest();

  it('names the app and opens it where it is, whatever folder it is served from', () => {
    expect(m.name).toBe('Okey');
    expect(m.short_name).toBe('Okey');
    // Relative: the game is on GitHub Pages under /okey-playable/ and on itch.io under a path of its own.
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.id).toBe('./');
    expect(m.display).toBe('standalone');
    for (const icon of m.icons) expect(icon.src.startsWith('/'), icon.src).toBe(false);
  });

  it('has the icons an install needs: 192 and 512 px, and a 512 px one that may be cut to a shape', () => {
    const sizes = m.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes).sort();
    expect(sizes).toEqual(['192x192', '512x512']);
    expect(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    for (const icon of m.icons) expect(icon.type).toBe('image/png');
  });

  it('is coloured like the table: the felt, and its darkest shade behind the splash', () => {
    const felt = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    expect(THEME_COLOR).toBe(felt('felt-mid'));
    expect(BACKGROUND_COLOR).toBe(felt('felt-lo'));
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(m.background_color).toBe(BACKGROUND_COLOR);
  });
});

describe('what the service worker keeps', () => {
  it('is the page under both its names and every file of the build, relative to the worker', () => {
    expect(precacheList(['assets/a.js', 'assets/a.css', 'index.html'])).toEqual(['./', './assets/a.js', './assets/a.css', './index.html']);
  });
});

/**
 * The service worker's own code, run against a stand-in for its world: a cache store, a network that can be off,
 * and the events the browser sends. What the real browser does with it is checked by scripts/pwa-check.mjs.
 */
function worker(files: string[], version = 'v1') {
  const base = 'https://example.test/app/sw.js';
  const listeners: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, string>>();
  const path = (url: string | { url: string }) => new URL(typeof url === 'string' ? url : url.url, base).pathname;
  const network = { online: true, asked: [] as string[] };

  class FakeRequest {
    url: string;
    constructor(url: string, public init?: unknown) {
      this.url = new URL(url, base).href;
    }
  }
  class FakeResponse {
    constructor(public body: string, public error = false) {}
    static error() {
      return new FakeResponse('', true);
    }
  }
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, string>();
      stores.set(name, store);
      return { addAll: async (requests: FakeRequest[]) => requests.forEach((r) => store.set(path(r), `kept ${path(r)}`)) };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | FakeRequest) => {
      for (const store of stores.values()) {
        const found = store.get(path(request));
        if (found) return new FakeResponse(found);
      }
      return undefined;
    },
  };
  const fetchFn = async (request: FakeRequest) => {
    network.asked.push(path(request));
    if (!network.online) throw new TypeError('offline');
    return new FakeResponse(`network ${path(request)}`);
  };
  const self = {
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: 'https://example.test' },
  };
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', serviceWorkerSource(version, files))(self, caches, fetchFn, FakeRequest, FakeResponse, URL);

  /** An event whose waitUntil / respondWith promise can be waited for. */
  const run = async (type: string) => {
    let promise: Promise<unknown> = Promise.resolve();
    listeners[type]({ waitUntil: (p: Promise<unknown>) => (promise = p) });
    await promise;
  };
  const fetched = async (url: string, over: Record<string, unknown> = {}) => {
    let responded: Promise<any> | null = null;
    listeners.fetch({ request: { url, method: 'GET', mode: 'cors', ...over }, respondWith: (p: Promise<any>) => (responded = p) });
    return responded === null ? null : await (responded as Promise<any>);
  };
  return { listeners, stores, network, self, run, fetched };
}

describe('the service worker', () => {
  const files = ['./', './assets/a.js', './index.html'];

  it('keeps every file of the build when it installs, and takes over at once', async () => {
    const w = worker(files, 'abc');
    await w.run('install');
    expect([...w.stores.keys()]).toEqual(['okey-abc']);
    expect([...w.stores.get('okey-abc')!.keys()].sort()).toEqual(['/app/', '/app/assets/a.js', '/app/index.html']);
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  it('drops the files of an older build, and of nothing else, when it takes over', async () => {
    const w = worker(files, 'new');
    w.stores.set('okey-old', new Map());
    w.stores.set('other-app', new Map());
    await w.run('install');
    await w.run('activate');
    expect([...w.stores.keys()].sort()).toEqual(['okey-new', 'other-app']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('answers from what it kept, without asking the network, however the page was opened', async () => {
    const w = worker(files);
    await w.run('install');
    w.network.asked.length = 0;
    for (const url of ['https://example.test/app/', 'https://example.test/app/?lang=de', 'https://example.test/app/?seed=9&lang=nl', 'https://example.test/app/assets/a.js']) {
      expect((await w.fetched(url)).body, url).toMatch(/^kept /);
    }
    expect(w.network.asked).toEqual([]);
  });

  it('plays offline: a navigation with the network off still gets the page', async () => {
    const w = worker(files);
    await w.run('install');
    w.network.online = false;
    expect((await w.fetched('https://example.test/app/', { mode: 'navigate' })).body).toMatch(/^kept /);
    // Something that was never kept and cannot be fetched fails the way a network does, not with the page.
    expect((await w.fetched('https://example.test/app/unknown.png')).error).toBe(true);
    // ...unless it is a page, when the game's own page is better than an error.
    expect((await w.fetched('https://example.test/app/somewhere', { mode: 'navigate' })).body).toBe('kept /app/index.html');
  });

  it('goes to the network for what it did not keep, and leaves everything else alone', async () => {
    const w = worker(files);
    await w.run('install');
    expect((await w.fetched('https://example.test/app/other.json')).body).toBe('network /app/other.json');
    // Not its business: another site, and anything but a GET.
    expect(await w.fetched('https://elsewhere.test/app/', {})).toBeNull();
    expect(await w.fetched('https://example.test/app/', { method: 'POST' })).toBeNull();
  });
});
