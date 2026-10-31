import './ui/styles.css';
import { Controller } from './app/controller';
import { emptySave, parseSave } from './app/save';
import { Scheduler } from './app/scheduler';
import { Sound } from './app/sound';
import { pickStrings } from './i18n';
import { createPlatform } from './platform/playables';
import { registerServiceWorker } from './platform/pwa';
import { View } from './ui/view';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function boot(): Promise<void> {
  const platform = createPlatform();
  window.addEventListener('error', () => platform.logError());
  window.addEventListener('unhandledrejection', () => platform.logError());

  // The splash from index.html is on screen.
  await nextFrame();
  platform.firstFrameReady();

  const [loaded, language] = await Promise.all([
    platform.loadData().then(
      (raw) => ({ save: parseSave(raw), ok: true }),
      () => ({ save: emptySave(), ok: false }),
    ),
    platform.getLanguage().catch(() => 'en'),
  ]);
  if (!loaded.ok) platform.logWarning();

  const strings = pickStrings(language);
  document.documentElement.lang = strings.langTag;

  const scheduler = new Scheduler();
  const sound = new Sound(platform.isAudioEnabled());
  platform.onAudioEnabledChange((enabled) => sound.setEnabled(enabled));

  // `?seed=N` deals that hand first. Only in dev and in the web build: `MODE` is a build-time
  // constant, so the Playables build does not contain this, and a player there cannot pick their deal.
  let firstSeed: number | undefined;
  if (import.meta.env.DEV || import.meta.env.MODE === 'web') {
    const asked = Number(new URLSearchParams(location.search).get('seed'));
    if (Number.isInteger(asked) && asked > 0) firstSeed = asked;
  }

  const game = new Controller({ platform, scheduler, sound, firstSeed }, loaded.save, loaded.ok);
  const view = new View(document.getElementById('app')!, game, strings);
  game.subscribe(() => view.render());
  // The clock ticks on its own: redrawing the table every second would restart
  // the animations and cost a full layout.
  game.subscribeClock(() => view.updateClock());
  // Dev only (stripped from builds): poke at the state from the console.
  if (import.meta.env.DEV) Object.assign(window, { okeyGame: game, okeyView: view });

  platform.onPause(() => {
    scheduler.pause();
    sound.pause();
    // A tile in flight has to freeze too, or the table keeps moving while the
    // game is paused.
    view.pauseMotion();
    game.pauseClock();
    void game.persist();
  });
  platform.onResume(() => {
    scheduler.resume();
    sound.resume();
    view.resumeMotion();
    game.resumeClock();
  });

  view.render();
  await nextFrame();
  platform.gameReady();
  game.begin();
  // Offline play and installing: the web build only (a build-time constant, so the Playables build has no trace of it).
  if (import.meta.env.MODE === 'web') registerServiceWorker();
}

void boot();
