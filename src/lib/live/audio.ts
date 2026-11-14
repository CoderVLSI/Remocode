import {
  addExpoTwoWayAudioEventListener,
  initialize,
  playPCMData,
  requestMicrophonePermissionsAsync,
  tearDown,
  toggleRecording,
} from '@speechmatics/expo-two-way-audio';

import { LinearResampler, base64ToBytes, bytesToBase64, bytesToInt16, int16ToBytes } from './pcm';
import { PlaybackScheduler } from './playback';
import { INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE } from './protocol';

/**
 * Microphone in, model voice out, for the Live session.
 *
 * The native module gives echo-cancelled 16 kHz mic samples and plays 16 kHz PCM; Gemini speaks at
 * 24 kHz, so replies are resampled, and released through a PlaybackScheduler so barge-in can
 * actually silence the model.
 */
export class LiveAudio {
  private readonly resampler = new LinearResampler(OUTPUT_SAMPLE_RATE, INPUT_SAMPLE_RATE);
  private readonly scheduler: PlaybackScheduler;
  private micSub: { remove(): void } | null = null;
  private ready = false;
  private speaking = false;

  /** Fires when the model starts or stops audibly speaking. */
  onSpeakingChange?: (speaking: boolean) => void;

  constructor() {
    this.scheduler = new PlaybackScheduler(
      {
        play: (pcm) => playPCMData(pcm),
        now: () => performance.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      { sampleRate: INPUT_SAMPLE_RATE },
    );
    this.scheduler.onIdle = () => this.setSpeaking(false);
  }

  private setSpeaking(v: boolean) {
    if (this.speaking === v) return;
    this.speaking = v;
    this.onSpeakingChange?.(v);
  }

  /** Asks for the microphone and starts the audio engine. Throws a readable error if refused. */
  async prepare(): Promise<void> {
    const perm = await requestMicrophonePermissionsAsync();
    if (!perm.granted) throw new Error('Microphone permission was denied. Enable it for Remocode in system settings.');
    await initialize();
    this.ready = true;
  }

  /** Starts streaming mic audio as base64 16 kHz PCM. */
  startMic(onChunk: (base64: string) => void): void {
    if (!this.ready) throw new Error('Audio is not prepared.');
    this.micSub?.remove();
    this.micSub = addExpoTwoWayAudioEventListener('onMicrophoneData', (e: { data: Uint8Array }) => {
      onChunk(bytesToBase64(e.data));
    });
    toggleRecording(true);
  }

  setMuted(muted: boolean): void {
    if (this.ready) toggleRecording(!muted);
  }

  /** Queues a base64 24 kHz PCM chunk from the model. */
  play(base64: string): void {
    if (!this.ready) return;
    const pcm16k = this.resampler.process(bytesToInt16(base64ToBytes(base64)));
    if (pcm16k.length === 0) return;
    this.setSpeaking(true);
    this.scheduler.enqueue(int16ToBytes(pcm16k));
  }

  /** The user spoke over the model: drop everything not yet handed to the speaker. */
  interrupt(): void {
    this.scheduler.clear();
    this.resampler.reset();
  }

  stop(): void {
    this.interrupt();
    this.micSub?.remove();
    this.micSub = null;
    if (this.ready) {
      try {
        toggleRecording(false);
        tearDown();
      } catch {
        // already torn down
      }
    }
    this.ready = false;
    this.setSpeaking(false);
  }
}
