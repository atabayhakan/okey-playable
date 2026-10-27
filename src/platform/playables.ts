/**
 * Everything the game needs from YouTube, behind one interface. Inside Playables this
 * forwards to `ytgame`; anywhere else (local dev, offline) a stand-in keeps the game playable.
 */
export interface Platform {
  readonly inPlayables: boolean;
  firstFrameReady(): void;
  gameReady(): void;
  loadData(): Promise<string>;
  saveData(data: string): Promise<void>;
  getLanguage(): Promise<string>;
  isAudioEnabled(): boolean;
  onAudioEnabledChange(callback: (enabled: boolean) => void): () => void;
  onPause(callback: () => void): () => void;
  onResume(callback: () => void): () => void;
  sendScore(value: number): Promise<void>;
  requestInterstitialAd(): Promise<void>;
  requestRewardedAd(rewardId: string): Promise<boolean>;
  logError(): void;
  logWarning(): void;
}

export function createPlatform(): Platform {
  const yt = (globalThis as { ytgame?: typeof ytgame }).ytgame;
  return yt?.IN_PLAYABLES_ENV ? youtubePlatform(yt) : devPlatform();
}

function youtubePlatform(yt: typeof ytgame): Platform {
  return {
    inPlayables: true,
    firstFrameReady: () => yt.game.firstFrameReady(),
    gameReady: () => yt.game.gameReady(),
    loadData: () => yt.game.loadData(),
    saveData: (data) => yt.game.saveData(data),
    getLanguage: () => yt.system.getLanguage(),
    isAudioEnabled: () => yt.system.isAudioEnabled(),
    onAudioEnabledChange: (cb) => yt.system.onAudioEnabledChange(cb),
    onPause: (cb) => yt.system.onPause(cb),
    onResume: (cb) => yt.system.onResume(cb),
    sendScore: (value) => yt.engagement.sendScore({ value }),
    requestInterstitialAd: () => yt.ads.requestInterstitialAd(),
    requestRewardedAd: (rewardId) => yt.ads.requestRewardedAd(rewardId),
    logError: () => yt.health.logError(),
    logWarning: () => yt.health.logWarning(),
  };
}

const MAX_SAVE_BYTES = 3 * 1024 * 1024;
const SAVE_KEY = 'okey-save';

/**
 * The web build (`vite build --mode web`, for itch.io and the like) runs outside YouTube:
 * it keeps the save in the browser and picks the language from it. `MODE` is a constant at
 * build time, so everything behind this flag is removed from the Playables build, where
 * saving must go only through `saveData` and the language only through `getLanguage`.
 */
const WEB = import.meta.env.MODE === 'web';

/** localStorage can throw (private windows, blocked third-party storage): the game then plays without a saved game. */
function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Local stand-in. Query params: ?lang=tr, ?audio=off.
 * In `npm run dev` it also persists to localStorage and exposes `window.okeyDev`
 * (pause/resume/audio/clearSave). Those branches are stripped from production builds,
 * because Playables must save only through `saveData`. The web build persists too, and also
 * pauses the game while its tab is hidden.
 */
function devPlatform(): Platform {
  const params = new URLSearchParams(location.search);
  let memory = '';
  let audio = params.get('audio') !== 'off';
  const pauseCallbacks = new Set<() => void>();
  const resumeCallbacks = new Set<() => void>();
  const audioCallbacks = new Set<(enabled: boolean) => void>();
  const listen = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return () => void set.delete(cb);
  };

  if (import.meta.env.DEV) {
    Object.assign(window, {
      okeyDev: {
        pause: () => pauseCallbacks.forEach((cb) => cb()),
        resume: () => resumeCallbacks.forEach((cb) => cb()),
        setAudio: (on: boolean) => {
          audio = on;
          audioCallbacks.forEach((cb) => cb(on));
        },
        clearSave: () => localStorage.removeItem(SAVE_KEY),
      },
    });
  }

  if (WEB) {
    // Nothing else tells the game that nobody is looking: bots would play on in a background tab.
    document.addEventListener('visibilitychange', () => {
      (document.hidden ? pauseCallbacks : resumeCallbacks).forEach((cb) => cb());
    });
  }

  const persist = import.meta.env.DEV || WEB;

  return {
    inPlayables: false,
    firstFrameReady: () => console.info('[playables] firstFrameReady'),
    gameReady: () => console.info('[playables] gameReady'),
    async loadData() {
      if (persist) return storage()?.getItem(SAVE_KEY) ?? memory;
      return memory;
    },
    async saveData(data) {
      if (data.length * 2 > MAX_SAVE_BYTES) throw new Error('Save data exceeds 3 MiB');
      memory = data;
      if (persist) storage()?.setItem(SAVE_KEY, data);
    },
    async getLanguage() {
      const asked = params.get('lang');
      if (asked) return asked;
      return WEB ? navigator.language : 'en';
    },
    isAudioEnabled: () => audio,
    onAudioEnabledChange: (cb) => listen(audioCallbacks, cb),
    onPause: (cb) => listen(pauseCallbacks, cb),
    onResume: (cb) => listen(resumeCallbacks, cb),
    async sendScore(value) {
      console.info('[playables] sendScore', value);
    },
    async requestInterstitialAd() {
      console.info('[playables] interstitial ad');
    },
    async requestRewardedAd(rewardId) {
      console.info('[playables] rewarded ad', rewardId);
      return true;
    },
    logError: () => console.warn('[playables] logError'),
    logWarning: () => console.warn('[playables] logWarning'),
  };
}
