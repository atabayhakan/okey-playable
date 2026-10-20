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
const DEV_SAVE_KEY = 'okey-dev-save';

/**
 * Local stand-in. Query params: ?lang=tr, ?audio=off.
 * In `npm run dev` it also persists to localStorage and exposes `window.okeyDev`
 * (pause/resume/audio/clearSave). Those branches are stripped from production builds,
 * because Playables must save only through `saveData`.
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
        clearSave: () => localStorage.removeItem(DEV_SAVE_KEY),
      },
    });
  }

  return {
    inPlayables: false,
    firstFrameReady: () => console.info('[playables] firstFrameReady'),
    gameReady: () => console.info('[playables] gameReady'),
    async loadData() {
      if (import.meta.env.DEV) return localStorage.getItem(DEV_SAVE_KEY) ?? '';
      return memory;
    },
    async saveData(data) {
      if (data.length * 2 > MAX_SAVE_BYTES) throw new Error('Save data exceeds 3 MiB');
      memory = data;
      if (import.meta.env.DEV) localStorage.setItem(DEV_SAVE_KEY, data);
    },
    async getLanguage() {
      return params.get('lang') ?? 'en';
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
