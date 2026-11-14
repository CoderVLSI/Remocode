import { LinearResampler, base64ToBytes, bytesToBase64, bytesToInt16, int16ToBytes } from '../pcm';
import { PlaybackScheduler } from '../playback';
import {
  buildSetupMessage,
  audioChunkMessage,
  liveUrl,
  parseDurationMs,
  parseServerMessage,
  toGeminiSchema,
  toolResponseMessage,
} from '../protocol';

// Jest runs in Node; declare just the part of Buffer we use as an independent reference encoder.
declare const Buffer: { from(data: Uint8Array): { toString(encoding: 'base64'): string } };

describe('setup message', () => {
  it('requests audio out, transcripts, resumption and compression, and prefixes the model', () => {
    const { setup } = buildSetupMessage({ model: 'gemini-live-x', voiceName: 'Kore', systemInstruction: 'Be brief.' }) as any;
    expect(setup.model).toBe('models/gemini-live-x');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
    expect(setup.systemInstruction.parts[0].text).toBe('Be brief.');
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.contextWindowCompression).toEqual({ slidingWindow: {} });
    expect(setup.sessionResumption).toEqual({});
    expect(setup.tools).toBeUndefined();
  });

  it('keeps an existing models/ prefix and passes a resumption handle', () => {
    const { setup } = buildSetupMessage({ model: 'models/m', resumptionHandle: 'h1' }) as any;
    expect(setup.model).toBe('models/m');
    expect(setup.sessionResumption).toEqual({ handle: 'h1' });
  });

  it('declares tools with upper-case schema types, recursively', () => {
    const { setup } = buildSetupMessage({
      model: 'm',
      tools: [
        {
          name: 'read',
          description: 'Read',
          parameters: { type: 'object', properties: { path: { type: 'string', description: 'p' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['path'] },
        },
      ],
    }) as any;
    const decl = setup.tools[0].functionDeclarations[0];
    expect(decl.parameters.type).toBe('OBJECT');
    expect(decl.parameters.properties.path.type).toBe('STRING');
    expect(decl.parameters.properties.tags.items.type).toBe('STRING');
    expect(decl.parameters.required).toEqual(['path']);
    expect(toGeminiSchema({ type: 'number' })).toEqual({ type: 'NUMBER' });
  });

  it('builds the URL with an encoded key', () => {
    expect(liveUrl('a b&c')).toMatch(/BidiGenerateContent\?key=a%20b%26c$/);
  });
});

describe('client messages', () => {
  it('wraps audio and tool responses in the documented shapes', () => {
    expect(audioChunkMessage('AAA=')).toEqual({ realtimeInput: { audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=16000' } } });
    expect(
      toolResponseMessage([
        { id: '1', name: 'a', output: 'ok' },
        { id: '2', name: 'b', output: 'boom', isError: true },
      ]),
    ).toEqual({
      toolResponse: {
        functionResponses: [
          { id: '1', name: 'a', response: { output: 'ok' } },
          { id: '2', name: 'b', response: { error: 'boom' } },
        ],
      },
    });
  });
});

describe('parseServerMessage', () => {
  it('reads setupComplete', () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: 'setupComplete' }]);
  });

  it('emits interruption before audio from the same frame, then transcripts and turn end', () => {
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: {
          interrupted: true,
          modelTurn: { parts: [{ inlineData: { data: 'QUJD', mimeType: 'audio/pcm;rate=24000' } }, { text: 'ignored' }] },
          inputTranscription: { text: 'hello' },
          outputTranscription: { text: 'hi there' },
          turnComplete: true,
        },
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['interrupted', 'audio', 'inputTranscript', 'outputTranscript', 'turnComplete']);
    expect(events[1]).toMatchObject({ base64: 'QUJD', mimeType: 'audio/pcm;rate=24000' });
  });

  it('reads tool calls, cancellations, goAway and resumption updates', () => {
    const events = parseServerMessage(
      JSON.stringify({
        toolCall: { functionCalls: [{ id: 'c1', name: 'drive_search', args: { query: 'x' } }, { name: 'noid' }] },
        toolCallCancellation: { ids: ['c1'] },
        goAway: { timeLeft: '30s' },
        sessionResumptionUpdate: { newHandle: 'H', resumable: true },
      }),
    );
    const call: any = events.find((e) => e.type === 'toolCall');
    expect(call.calls[0]).toEqual({ id: 'c1', name: 'drive_search', args: { query: 'x' } });
    expect(call.calls[1].id).toMatch(/^call_/); // the server must give ids, but never crash if it does not
    expect(call.calls[1].args).toEqual({});
    expect(events).toContainEqual({ type: 'toolCancel', ids: ['c1'] });
    expect(events).toContainEqual({ type: 'goAway', timeLeftMs: 30_000 });
    expect(events).toContainEqual({ type: 'resumption', handle: 'H', resumable: true });
  });

  it('treats an empty handle as not resumable and ignores junk', () => {
    expect(parseServerMessage('{"sessionResumptionUpdate":{"resumable":false}}')).toEqual([{ type: 'resumption', handle: null, resumable: false }]);
    expect(parseServerMessage('not json')).toEqual([]);
    expect(parseServerMessage('{"error":{"message":"bad"}}')).toEqual([{ type: 'error', message: 'bad' }]);
  });

  it('parses durations', () => {
    expect(parseDurationMs('1.5s')).toBe(1500);
    expect(parseDurationMs('x')).toBeUndefined();
    expect(parseDurationMs(undefined)).toBeUndefined();
  });
});

describe('base64 and PCM', () => {
  it('matches Node Buffer for every length mod 3 and for random data', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(bytes));
    }
  });

  it('rejects invalid base64', () => {
    expect(() => base64ToBytes('@@@@')).toThrow(/Invalid base64/);
  });

  it('round-trips 16-bit little-endian samples, including odd byte counts and offsets', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 12345]);
    expect(Array.from(bytesToInt16(int16ToBytes(samples)))).toEqual(Array.from(samples));
    const bytes = int16ToBytes(samples);
    const shifted = new Uint8Array(bytes.length + 3);
    shifted.set(bytes, 3);
    expect(Array.from(bytesToInt16(shifted.subarray(3)))).toEqual(Array.from(samples));
    expect(bytesToInt16(new Uint8Array(5)).length).toBe(2); // trailing odd byte ignored
  });
});

describe('LinearResampler 24k -> 16k', () => {
  const sine = (n: number, rate: number, hz: number) => Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)));

  it('produces two thirds as many samples', () => {
    const out = new LinearResampler(24000, 16000).process(sine(2400, 24000, 440));
    expect(Math.abs(out.length - 1600)).toBeLessThanOrEqual(1);
  });

  it('gives (almost) the same result whether fed whole or in uneven chunks', () => {
    const input = sine(4800, 24000, 300);
    const whole = new LinearResampler(24000, 16000).process(input);
    const r = new LinearResampler(24000, 16000);
    const parts = [r.process(input.subarray(0, 7)), r.process(input.subarray(7, 1000)), r.process(input.subarray(1000, 1001)), r.process(input.subarray(1001))];
    const joined = Int16Array.from(parts.flatMap((p) => Array.from(p)));
    expect(joined.length).toBe(whole.length);
    let maxDiff = 0;
    for (let i = 0; i < whole.length; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - joined[i]));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it('keeps a pure tone at the right frequency (zero crossings)', () => {
    const out = new LinearResampler(24000, 16000).process(sine(24000, 24000, 500)); // 1 s of 500 Hz
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) crossings++;
    expect(Math.abs(crossings - 1000)).toBeLessThanOrEqual(2);
  });

  it('handles empty input and clamps', () => {
    const r = new LinearResampler(24000, 16000);
    expect(r.process(new Int16Array(0)).length).toBe(0);
    const out = r.process(Int16Array.from([32767, 32767, 32767, 32767]));
    expect(Math.max(...out)).toBeLessThanOrEqual(32767);
  });
});

describe('PlaybackScheduler', () => {
  function harness(opts = {}) {
    let t = 0;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let nextId = 1;
    const played: number[] = [];
    const sched = new PlaybackScheduler(
      {
        play: (pcm) => played.push(pcm.length),
        now: () => t,
        setTimer: (fn, ms) => {
          const id = nextId++;
          timers.push({ at: t + ms, fn, id });
          return id;
        },
        clearTimer: (h) => {
          const i = timers.findIndex((x) => x.id === h);
          if (i >= 0) timers.splice(i, 1);
        },
      },
      { sampleRate: 16000, ...opts },
    );
    const advance = (ms: number) => {
      const end = t + ms;
      while (true) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
      }
      t = end;
    };
    return { sched, played, advance, now: () => t };
  }
  const ms = (n: number) => new Uint8Array(n * 32); // 16 kHz mono 16-bit = 32 bytes per ms

  it('holds audio back instead of flooding the engine, so a clear can silence it', () => {
    const { sched, played } = harness({ lookaheadMs: 250, maxChunkMs: 100 });
    sched.enqueue(ms(2000)); // two seconds arrive at once
    const handedOver = played.reduce((a, b) => a + b, 0) / 32;
    expect(handedOver).toBeLessThanOrEqual(400); // about the lookahead, never the whole two seconds
    expect(sched.queuedMs).toBeGreaterThan(1500);
    const dropped = sched.clear();
    expect(dropped).toBeGreaterThan(1500);
    expect(sched.queuedMs).toBe(0);
  });

  it('plays everything in order over time, then reports idle once', () => {
    const { sched, played, advance } = harness({ lookaheadMs: 250, maxChunkMs: 100 });
    let idle = 0;
    sched.onIdle = () => idle++;
    sched.enqueue(ms(1000));
    advance(5000);
    expect(played.reduce((a, b) => a + b, 0)).toBe(1000 * 32);
    expect(idle).toBe(1);
    expect(sched.isPlaying()).toBe(false);
  });

  it('restarts the playhead after an underrun', () => {
    const { sched, played, advance } = harness({ lookaheadMs: 250, maxChunkMs: 100 });
    sched.enqueue(ms(100));
    advance(2000); // long gap: playback finished
    const before = played.length;
    sched.enqueue(ms(100));
    expect(played.length).toBe(before + 1); // handed over immediately, not delayed by a stale playhead
  });

  it('reports idle after a clear once what was already handed over has played', () => {
    const { sched, advance } = harness({ lookaheadMs: 250, maxChunkMs: 100 });
    let idle = 0;
    sched.onIdle = () => idle++;
    sched.enqueue(ms(2000));
    sched.clear();
    advance(1000);
    expect(idle).toBe(1);
  });

  it('ignores empty chunks', () => {
    const { sched, played } = harness();
    sched.enqueue(new Uint8Array(0));
    expect(played).toEqual([]);
  });
});
