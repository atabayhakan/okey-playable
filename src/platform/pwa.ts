/**
 * The web build's service worker (generated into the build by scripts/pwa-plugin.mjs): it keeps the game for
 * offline play and for installing it. Only the web build calls this; the call is behind `MODE === 'web'`, which is
 * a constant at build time, so the Playables build does not contain this file (it must not use service workers).
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    // A failure (a page in an iframe that may not, a private window) only means no offline play: say nothing.
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  };
  // After the page has loaded: the game's own start is not made to wait for it.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
