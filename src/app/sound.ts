/**
 * Synthesized sound effects, so there are no audio files to load. Follows the YouTube
 * audio setting (isAudioEnabled / onAudioEnabledChange) and goes silent while paused.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private paused = false;

  constructor(private enabled: boolean) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.sync();
  }

  pause(): void {
    this.paused = true;
    this.sync();
  }

  resume(): void {
    this.paused = false;
    this.sync();
  }

  /** Short wooden click for a tile being placed. */
  tile(): void {
    if (!this.enabled || this.paused) return;
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(820, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.06);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  private sync(): void {
    if (!this.ctx) return;
    const action = this.enabled && !this.paused ? this.ctx.resume() : this.ctx.suspend();
    action.catch(() => undefined);
  }
}
