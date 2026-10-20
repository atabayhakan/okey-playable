// Types for the YouTube Playables SDK (https://www.youtube.com/game_api/v1), matching the
// official index.d.ts from the Playables docs. Only the public, non-deprecated API is listed.

declare namespace ytgame {
  class SdkError extends Error {
    errorType: number;
  }
  const SDK_VERSION: string;
  const IN_PLAYABLES_ENV: boolean;
}

declare namespace ytgame.game {
  function firstFrameReady(): void;
  function gameReady(): void;
  function loadData(): Promise<string>;
  /** Well-formed UTF-16, at most 3 MiB. */
  function saveData(data: string): Promise<void>;
}

declare namespace ytgame.system {
  function isAudioEnabled(): boolean;
  function onAudioEnabledChange(callback: (isAudioEnabled: boolean) => void): () => void;
  function onPause(callback: () => void): () => void;
  function onResume(callback: () => void): () => void;
  /** BCP-47 tag of the user's YouTube language. */
  function getLanguage(): Promise<string>;
}

declare namespace ytgame.engagement {
  interface Score {
    value: number;
  }
  function sendScore(score: Score): Promise<void>;
  interface Content {
    id: string;
    contentType?: number;
  }
  function openYTContent(content: Content): Promise<void>;
}

declare namespace ytgame.ads {
  function requestInterstitialAd(): Promise<void>;
  function requestRewardedAd(rewardId: string): Promise<boolean>;
}

declare namespace ytgame.health {
  function logError(): void;
  function logWarning(): void;
}
