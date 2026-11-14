import { bytesPerMs } from './pcm';

export interface PlaybackDeps {
  /** Hands PCM to the audio engine, which plays it back-to-back in order. */
  play(pcm: Uint8Array): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * The audio engine has no way to flush what it has already been given, and Gemini streams
 * audio faster than real time. If we handed everything over immediately, barge-in would keep
 * talking for seconds. So audio waits here and is released just ahead of the playhead; clearing
 * this queue then silences the model within about `lookaheadMs`.
 */
export class PlaybackScheduler {
  private queue: Uint8Array[] = [];
  private playheadEnd = 0; // when everything handed to the engine so far will have finished
  private timer: unknown = null;
  /** Called once the last handed-over audio has finished playing. */
  onIdle?: () => void;
  private idleArmed = false;

  constructor(
    private readonly deps: PlaybackDeps,
    private readonly opts: { sampleRate: number; lookaheadMs?: number; maxChunkMs?: number } = { sampleRate: 16_000 },
  ) {}

  private get lookahead() {
    return this.opts.lookaheadMs ?? 250;
  }

  private durationMs(chunk: Uint8Array) {
    return chunk.length / bytesPerMs(this.opts.sampleRate);
  }

  /** Splits large chunks so a later clear() has fine granularity. */
  enqueue(pcm: Uint8Array): void {
    if (pcm.length === 0) return;
    const maxBytes = Math.floor(bytesPerMs(this.opts.sampleRate) * (this.opts.maxChunkMs ?? 120)) & ~1;
    for (let i = 0; i < pcm.length; i += maxBytes) this.queue.push(pcm.subarray(i, Math.min(pcm.length, i + maxBytes)));
    this.idleArmed = true;
    this.pump();
  }

  /** Drops audio that has not been handed to the engine yet. Returns how many ms were dropped. */
  clear(): number {
    const dropped = this.queue.reduce((ms, c) => ms + this.durationMs(c), 0);
    this.queue = [];
    this.cancelTimer();
    // What the engine already has will finish within `lookahead`; arm idle for that moment.
    if (this.idleArmed) this.scheduleIdle();
    return dropped;
  }

  /** Milliseconds of audio still waiting in this queue (not yet with the engine). */
  get queuedMs(): number {
    return this.queue.reduce((ms, c) => ms + this.durationMs(c), 0);
  }

  isPlaying(): boolean {
    return this.queue.length > 0 || this.playheadEnd > this.deps.now();
  }

  private cancelTimer() {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private scheduleIdle() {
    this.cancelTimer();
    const wait = Math.max(0, this.playheadEnd - this.deps.now());
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (this.queue.length === 0 && this.idleArmed) {
        this.idleArmed = false;
        this.onIdle?.();
      }
    }, wait);
  }

  private pump = () => {
    this.cancelTimer();
    const now = this.deps.now();
    // After an underrun the playhead is in the past: restart it from now.
    if (this.playheadEnd < now) this.playheadEnd = now;
    while (this.queue.length && this.playheadEnd - now < this.lookahead) {
      const chunk = this.queue.shift()!;
      this.deps.play(chunk);
      this.playheadEnd += this.durationMs(chunk);
    }
    if (this.queue.length) {
      // Wake when the buffer has drained back to the lookahead window.
      this.timer = this.deps.setTimer(this.pump, Math.max(10, this.playheadEnd - now - this.lookahead));
    } else {
      this.scheduleIdle();
    }
  };
}
