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

  /** Short wooden knock for a tile being placed. */
  tile(): void {
    this.knock(820, 260, 0.09, 0.25);
  }

  /** A tile sliding off the rack onto the pile: lower and softer than a knock. */
  throwTile(): void {
    this.knock(520, 190, 0.13, 0.2);
  }

  /** A bright two-note chime: a set or a run is now complete. */
  meld(): void {
    this.tone(784, 0.16, 'triangle', 0.18, 0);
    this.tone(1175, 0.22, 'triangle', 0.14, 0.09);
  }

  /** The indicator is shown: one clear bell. */
  show(): void {
    this.tone(1046, 0.28, 'sine', 0.16, 0);
  }

  /** The hand is finished: a small rising phrase. */
  win(): void {
    this.tone(523, 0.14, 'triangle', 0.16, 0);
    this.tone(659, 0.14, 'triangle', 0.16, 0.1);
    this.tone(784, 0.14, 'triangle', 0.16, 0.2);
    this.tone(1046, 0.3, 'triangle', 0.14, 0.3);
  }

  /** It is the player's turn: a soft blip, easy to hear but not sharp. */
  turn(): void {
    this.tone(660, 0.1, 'sine', 0.1, 0);
  }

  /** A wooden knock: a fast pitch drop from `from` to `to`. */
  private knock(from: number, to: number, dur: number, peak: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** One note of a melody. */
  private tone(freq: number, dur: number, type: OscillatorType, peak: number, delay: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * The audio context, created on first use. Browsers only let it run after a
   * user gesture, so it starts suspended and is resumed on the first sound.
   */
  private context(): AudioContext | null {
    if (!this.enabled || this.paused) return null;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private sync(): void {
    if (!this.ctx) return;
    const action = this.enabled && !this.paused ? this.ctx.resume() : this.ctx.suspend();
    action.catch(() => undefined);
  }
}
