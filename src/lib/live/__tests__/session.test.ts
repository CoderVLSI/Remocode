import { LiveSession, classifyClose, decodeFrame } from '../session';
import type { LiveHandlers, LiveTool, WebSocketLike } from '../session';

class FakeSocket implements WebSocketLike {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  // helpers that play the server's role
  open() {
    this.onopen?.({});
  }
  server(obj: object) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  serverClose(code: number, reason = '') {
    this.onclose?.({ code, reason });
  }
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

function setup(opts: { tools?: LiveTool[]; approve?: (r: any) => Promise<boolean>; handlers?: LiveHandlers; maxReconnects?: number } = {}) {
  const sockets: FakeSocket[] = [];
  const session = new LiveSession({
    apiKey: 'KEY',
    model: 'gemini-live-x',
    systemInstruction: 'sys',
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    setTimer: (fn) => {
      queueMicrotask(fn); // backoff timers fire immediately in tests
      return 0;
    },
    clearTimer: () => {},
    ...opts,
  });
  return { session, sockets, last: () => sockets[sockets.length - 1] };
}

async function connected(opts: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(opts);
  const p = ctx.session.connect();
  ctx.last().open();
  ctx.last().server({ setupComplete: {} });
  await p;
  return ctx;
}

const echoTool = (calls: unknown[] = []): LiveTool => ({
  spec: { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  execute: async (args) => {
    calls.push(args);
    return `echo:${args.text}`;
  },
});

describe('connect', () => {
  it('sends the setup on open and resolves on setupComplete', async () => {
    const { session, last } = await connected({ tools: [echoTool()] });
    expect(session.currentState).toBe('ready');
    const setup = last().sent[0].setup;
    expect(setup.model).toBe('models/gemini-live-x');
    expect(setup.tools[0].functionDeclarations[0].name).toBe('echo');
    expect(last().url).toContain('key=KEY');
    expect(last().binaryType).toBe('arraybuffer');
  });

  it('rejects with a classified error if the socket closes before setup', async () => {
    const { session, last } = setup();
    const p = session.connect();
    last().open();
    last().serverClose(1007, 'API key not valid. Please pass a valid API key.');
    await expect(p).rejects.toMatchObject({ kind: 'auth' });
  });

  it('rejects when the server reports an error before setup completes', async () => {
    const { session, last } = setup();
    const p = session.connect();
    last().open();
    last().server({ error: { message: 'model not found' } });
    await expect(p).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('classifyClose and decodeFrame', () => {
  it.each([
    [1008, 'Request had invalid authentication credentials', 'auth'],
    [1007, 'API key not valid', 'auth'],
    [1011, 'Resource has been exhausted (e.g. check quota).', 'quota'],
    [1008, 'models/foo is not found for API version', 'invalid'],
    [1006, '', 'network'],
    [4000, 'weird', 'unknown'],
  ])('%s %j -> %s', (code, reason, kind) => {
    expect(classifyClose(code, reason).kind).toBe(kind);
  });

  it('decodes text and binary JSON frames', () => {
    expect(decodeFrame('{"a":1}')).toBe('{"a":1}');
    expect(decodeFrame(new TextEncoder().encode('{"b":2}').buffer)).toBe('{"b":2}');
    expect(decodeFrame(new TextEncoder().encode('{"c":3}'))).toBe('{"c":3}');
    expect(decodeFrame(42)).toBe('');
  });
});

describe('audio and events', () => {
  it('forwards model audio, transcripts, interruptions and turn ends', async () => {
    const events: string[] = [];
    const { last } = await connected({
      handlers: {
        onAudio: (b) => events.push(`audio:${b}`),
        onInputTranscript: (t) => events.push(`in:${t}`),
        onOutputTranscript: (t) => events.push(`out:${t}`),
        onInterrupted: () => events.push('interrupted'),
        onTurnComplete: () => events.push('turn'),
      },
    });
    last().server({ serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { data: 'QQ==' } }] }, inputTranscription: { text: 'hey' }, outputTranscription: { text: 'yo' }, turnComplete: true } });
    expect(events).toEqual(['interrupted', 'audio:QQ==', 'in:hey', 'out:yo', 'turn']);
  });

  it('sends mic audio only while ready', async () => {
    const ctx = setup();
    ctx.session.sendAudio('AAAA'); // before connect: dropped
    const p = ctx.session.connect();
    ctx.last().open();
    ctx.last().server({ setupComplete: {} });
    await p;
    ctx.session.sendAudio('AAAA');
    ctx.session.sendText('hi');
    const kinds = ctx.last().sent.map((m) => Object.keys(m)[0]);
    expect(kinds).toEqual(['setup', 'realtimeInput', 'realtimeInput']);
    expect(ctx.last().sent[1].realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(ctx.last().sent[2].realtimeInput.text).toBe('hi');
  });
});

describe('tool calling', () => {
  it('runs a tool and sends its result back with the call id', async () => {
    const calls: unknown[] = [];
    const seen: string[] = [];
    const { last } = await connected({
      tools: [echoTool(calls)],
      handlers: { onToolStart: (c) => seen.push(`start:${c.name}`), onToolEnd: (c, r) => seen.push(`end:${r.output}`) },
    });
    last().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'echo', args: { text: 'hi' } }] } });
    await flush();
    expect(calls).toEqual([{ text: 'hi' }]);
    expect(last().sent[last().sent.length - 1]).toEqual({
      toolResponse: { functionResponses: [{ id: 'c1', name: 'echo', response: { output: 'echo:hi' } }] },
    });
    expect(seen).toEqual(['start:echo', 'end:echo:hi']);
  });

  it('answers several parallel calls in one message and reports unknown tools and failures as errors', async () => {
    const boom: LiveTool = { spec: { name: 'boom', description: 'b', parameters: { type: 'object' } }, execute: async () => { throw new Error('disk on fire'); } };
    const { last } = await connected({ tools: [echoTool(), boom] });
    last().server({ toolCall: { functionCalls: [{ id: '1', name: 'echo', args: { text: 'a' } }, { id: '2', name: 'boom', args: {} }, { id: '3', name: 'nope', args: {} }] } });
    await flush();
    const resp = last().sent[last().sent.length - 1].toolResponse.functionResponses;
    expect(resp).toEqual([
      { id: '1', name: 'echo', response: { output: 'echo:a' } },
      { id: '2', name: 'boom', response: { error: 'disk on fire' } },
      { id: '3', name: 'nope', response: { error: 'Unknown tool "nope".' } },
    ]);
  });

  it('asks for approval first and does not run a declined tool', async () => {
    const calls: unknown[] = [];
    const approve = jest.fn(async () => false);
    const tool: LiveTool = { ...echoTool(calls), needsApproval: true, describe: (a) => `say ${a.text}` };
    const { last } = await connected({ tools: [tool], approve });
    last().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'echo', args: { text: 'x' } }] } });
    await flush();
    expect(approve).toHaveBeenCalledWith({ name: 'echo', args: { text: 'x' }, description: 'say x' });
    expect(calls).toEqual([]);
    expect(last().sent[last().sent.length - 1].toolResponse.functionResponses[0].response).toEqual({ error: 'The user declined to run this action.' });
  });

  it('runs an approved tool, and refuses tools that need approval when no approver exists', async () => {
    const calls: unknown[] = [];
    const tool: LiveTool = { ...echoTool(calls), needsApproval: true };
    const ok = await connected({ tools: [tool], approve: async () => true });
    ok.last().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'echo', args: { text: 'y' } }] } });
    await flush();
    expect(calls).toEqual([{ text: 'y' }]);

    const noApprover = await connected({ tools: [tool] });
    noApprover.last().server({ toolCall: { functionCalls: [{ id: 'c2', name: 'echo', args: { text: 'z' } }] } });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('treats an approver that throws as a refusal', async () => {
    const calls: unknown[] = [];
    const { last } = await connected({ tools: [{ ...echoTool(calls), needsApproval: true }], approve: async () => { throw new Error('ui gone'); } });
    last().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'echo', args: {} }] } });
    await flush();
    expect(calls).toEqual([]);
  });

  it('aborts a cancelled call and sends no response for it', async () => {
    let aborted = false;
    const slow: LiveTool = {
      spec: { name: 'slow', description: 's', parameters: { type: 'object' } },
      execute: (_a, { signal }) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            resolve('late');
          });
        }),
    };
    const { last } = await connected({ tools: [slow] });
    last().server({ toolCall: { functionCalls: [{ id: 'c1', name: 'slow', args: {} }] } });
    await flush();
    last().server({ toolCallCancellation: { ids: ['c1'] } });
    await flush();
    expect(aborted).toBe(true);
    expect(last().sent.some((m) => m.toolResponse)).toBe(false);
  });
});

describe('reconnecting', () => {
  it('resumes with the latest handle after an unexpected close', async () => {
    const ctx = await connected();
    ctx.last().server({ sessionResumptionUpdate: { newHandle: 'H1', resumable: true } });
    const first = ctx.last();
    first.serverClose(1006);
    await flush();
    expect(ctx.sockets).toHaveLength(2);
    ctx.last().open();
    expect(ctx.last().sent[0].setup.sessionResumption).toEqual({ handle: 'H1' });
    ctx.last().server({ setupComplete: {} });
    await flush();
    expect(ctx.session.currentState).toBe('ready');
  });

  it('reports the error when there is no handle to resume with', async () => {
    const errors: string[] = [];
    const ctx = await connected({ handlers: { onError: (e) => errors.push(e.kind) } });
    ctx.last().serverClose(1006);
    await flush();
    expect(ctx.sockets).toHaveLength(1);
    expect(errors).toEqual(['network']);
    expect(ctx.session.currentState).toBe('closed');
  });

  it('gives up after the maximum number of attempts', async () => {
    const errors: string[] = [];
    const ctx = await connected({ maxReconnects: 2, handlers: { onError: (e) => errors.push(e.message) } });
    ctx.last().server({ sessionResumptionUpdate: { newHandle: 'H', resumable: true } });
    ctx.last().serverClose(1006);
    for (let i = 0; i < 4; i++) {
      await flush();
      const s = ctx.last();
      if (s.onopen) {
        s.open();
        s.serverClose(1006); // the new connection fails before setup completes
      }
    }
    await flush();
    expect(errors.some((m) => /gave up reconnecting/.test(m))).toBe(true);
    expect(ctx.sockets.length).toBeLessThanOrEqual(3);
  });

  it('moves to a fresh connection after goAway once the reply finishes', async () => {
    const ctx = await connected();
    ctx.last().server({ sessionResumptionUpdate: { newHandle: 'HX', resumable: true } });
    const old = ctx.last();
    ctx.last().server({ goAway: { timeLeft: '60s' } });
    expect(ctx.sockets).toHaveLength(1); // waits for a quiet moment
    ctx.last().server({ serverContent: { turnComplete: true } });
    await flush();
    expect(old.closed?.code).toBe(1000);
    expect(ctx.sockets).toHaveLength(2);
    ctx.last().open();
    expect(ctx.last().sent[0].setup.sessionResumption).toEqual({ handle: 'HX' });
    old.serverClose(1000); // late close from the retired socket must be ignored
    ctx.last().server({ setupComplete: {} });
    await flush();
    expect(ctx.session.currentState).toBe('ready');
  });

  it('does not reconnect after the user closes', async () => {
    const ctx = await connected();
    ctx.last().server({ sessionResumptionUpdate: { newHandle: 'H', resumable: true } });
    const s = ctx.last();
    ctx.session.close();
    s.serverClose(1000);
    await flush();
    expect(ctx.sockets).toHaveLength(1);
    expect(ctx.session.currentState).toBe('closed');
    expect(s.closed?.code).toBe(1000);
  });
});
