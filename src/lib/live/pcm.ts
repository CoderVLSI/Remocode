/** Base64 and 16-bit PCM helpers for the Live audio path. Pure, no native imports. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2] + ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < len ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < len ? ALPHABET[b2 & 63] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]+$/g, '').replace(/\s+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => {
      const code = clean.charCodeAt(i + k);
      if (Number.isNaN(code)) return 0;
      const v = code < 128 ? LOOKUP[code] : -1;
      if (v < 0) throw new Error('Invalid base64 data.');
      return v;
    });
    const n = Math.min(4, clean.length - i);
    out[o++] = (c[0] << 2) | (c[1] >> 4);
    if (n > 2) out[o++] = ((c[1] & 15) << 4) | (c[2] >> 2);
    if (n > 3) out[o++] = ((c[2] & 3) << 6) | c[3];
  }
  return out.subarray(0, o);
}

/** Little-endian 16-bit PCM bytes -> samples (alignment-safe). */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function int16ToBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return out;
}

/**
 * Streaming linear resampler. Keeps its fractional position and last sample between
 * chunks, so consecutive chunks join without clicks. 24 kHz -> 16 kHz for playback.
 */
export class LinearResampler {
  private readonly step: number;
  private pos = 0; // position in the virtual stream where index -1 is the previous chunk's last sample
  private prev = 0;

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate;
  }

  process(input: Int16Array): Int16Array {
    const n = input.length;
    if (n === 0) return new Int16Array(0);
    const out: number[] = [];
    let p = this.pos;
    while (p < n - 1) {
      const i = Math.floor(p);
      const a = i < 0 ? this.prev : input[i];
      const b = input[i + 1];
      const v = Math.round(a + (b - a) * (p - i));
      out.push(v > 32767 ? 32767 : v < -32768 ? -32768 : v);
      p += this.step;
    }
    this.pos = p - n;
    this.prev = input[n - 1];
    return Int16Array.from(out);
  }

  reset(): void {
    this.pos = 0;
    this.prev = 0;
  }
}

export const bytesPerMs = (sampleRate: number) => (sampleRate * 2) / 1000;
