import './ui/styles.css';
import { Controller } from './app/controller';
import { emptySave, parseSave } from './app/save';
import { Scheduler } from './app/scheduler';
import { Sound } from './app/sound';
import { pickStrings } from './i18n';
import { createPlatform } from './platform/playables';
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

  const game = new Controller({ platform, scheduler, sound }, loaded.save, loaded.ok);
  const view = new View(document.getElementById('app')!, game, strings);
  game.subscribe(() => view.render());
  // Dev only (stripped from builds): poke at the state from the console.
  if (import.meta.env.DEV) Object.assign(window, { okeyGame: game, okeyView: view });

  platform.onPause(() => {
    scheduler.pause();
    sound.pause();
    // A tile in flight has to freeze too, or the table keeps moving while the
    // game is paused.
    view.pauseMotion();
    void game.persist();
  });
  platform.onResume(() => {
    scheduler.resume();
    sound.resume();
    view.resumeMotion();
  });

  view.render();
  await nextFrame();
  platform.gameReady();
  game.begin();
}

void boot();
