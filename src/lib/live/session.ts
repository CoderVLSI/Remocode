import type { ToolExecutor } from '../llm/agent';
import { LLMError } from '../llm/types';

import {
  audioChunkMessage,
  audioStreamEndMessage,
  buildSetupMessage,
  liveUrl,
  parseServerMessage,
  textMessage,
  toolResponseMessage,
} from './protocol';
import type { FunctionResult, LiveEvent, LiveFunctionCall } from './protocol';

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
}

export type LiveState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';

export interface LiveTool extends ToolExecutor {
  /** Ask the user before running this tool (e.g. anything that acts on their computer). */
  needsApproval?: boolean;
  /** Short human description of what this call will do, shown in the approval prompt. */
  describe?: (args: Record<string, unknown>) => string;
}

export interface LiveHandlers {
  onState?(state: LiveState): void;
  /** Base64 24 kHz PCM from the model. */
  onAudio?(base64: string): void;
  onInputTranscript?(text: string): void;
  onOutputTranscript?(text: string): void;
  onTurnComplete?(): void;
  /** The user barged in: drop any audio that has not played yet. */
  onInterrupted?(): void;
  onToolStart?(call: LiveFunctionCall): void;
  onToolEnd?(call: LiveFunctionCall, result: FunctionResult): void;
  onError?(error: LLMError): void;
}

export interface LiveSessionOptions {
  apiKey: string;
  model: string;
  systemInstruction?: string;
  tools?: LiveTool[];
  voiceName?: string;
  createSocket: (url: string) => WebSocketLike;
  /** Resolves true to run the tool. Missing means tools needing approval are refused. */
  approve?: (req: { name: string; args: Record<string, unknown>; description: string }) => Promise<boolean>;
  handlers?: LiveHandlers;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  maxReconnects?: number;
}

/** Frames can arrive as text or as binary containing JSON. */
export function decodeFrame(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  return '';
}

/** Turns a WebSocket close into an actionable error. */
export function classifyClose(code: number, reason: string | undefined): LLMError {
  const r = (reason ?? '').trim();
  const lower = r.toLowerCase();
  if (/api key|api_key|permission|unauthor|forbidden|invalid.*key/.test(lower) || (code === 1008 && /key|auth/.test(lower))) {
    return new LLMError('auth', `Gemini rejected the API key${r ? `: ${r}` : '.'}`);
  }
  if (/quota|rate|resource.?exhausted|limit/.test(lower)) {
    return new LLMError('quota', `Gemini Live quota reached${r ? `: ${r}` : '.'}`);
  }
  if (/not found|not supported|unsupported|model/.test(lower)) {
    return new LLMError('invalid', `The Live model is unavailable${r ? `: ${r}` : '.'} Pick another in Settings → Models.`);
  }
  if (code === 1006) return new LLMError('network', 'Connection lost. Check your network and try again.');
  return new LLMError('unknown', `Live connection closed (${code})${r ? `: ${r}` : '.'}`);
}

const NORMAL_CLOSE = 1000;

export class LiveSession {
  private ws: WebSocketLike | null = null;
  private state: LiveState = 'idle';
  private handle: string | null = null; // latest resumable session handle
  private userClosed = false;
  private rotating = false; // set after GoAway: reconnect at the next safe moment
  private rotateTimer: unknown = null;
  private reconnects = 0;
  private readonly active = new Map<string, AbortController>();
  private readonly toolByName: Map<string, LiveTool>;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly o: LiveSessionOptions) {
    this.toolByName = new Map((o.tools ?? []).map((t) => [t.spec.name, t]));
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get currentState(): LiveState {
    return this.state;
  }

  private setState(s: LiveState) {
    if (this.state === s) return;
    this.state = s;
    this.o.handlers?.onState?.(s);
  }

  /** Opens the socket and resolves once the server has accepted the setup. */
  connect(): Promise<void> {
    this.userClosed = false;
    this.setState('connecting');
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = this.o.createSocket(liveUrl(this.o.apiKey));
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const fail = (err: LLMError) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.onopen = () => {
        ws.send(
          JSON.stringify(
            buildSetupMessage({
              model: this.o.model,
              systemInstruction: this.o.systemInstruction,
              tools: this.o.tools?.map((t) => t.spec),
              voiceName: this.o.voiceName,
              resumptionHandle: this.handle,
            }),
          ),
        );
      };

      ws.onmessage = (ev) => {
        for (const event of parseServerMessage(decodeFrame(ev.data))) {
          if (event.type === 'setupComplete' && !settled) {
            settled = true;
            this.reconnects = 0;
            this.setState('ready');
            resolve();
          }
          if (event.type === 'error') fail(new LLMError('invalid', event.message));
          this.dispatch(event);
        }
      };

      ws.onerror = () => {
        // The close event that follows carries the code and reason; wait for it.
      };

      ws.onclose = (ev) => {
        if (this.ws !== ws) return; // an old socket closing after we already rotated to a new one
        const closeErr = classifyClose(ev.code, ev.reason);
        if (!settled) return fail(closeErr);
        this.onSocketClosed(ev.code, closeErr);
      };
    });
  }

  private onSocketClosed(code: number, err: LLMError) {
    this.cancelTools();
    if (this.userClosed || (code === NORMAL_CLOSE && !this.rotating)) {
      this.setState('closed');
      return;
    }
    void this.reconnect(err);
  }

  private async reconnect(cause: LLMError) {
    const max = this.o.maxReconnects ?? 3;
    // Without a handle the model would lose the conversation, so say so instead of silently restarting.
    if (!this.handle || this.reconnects >= max) {
      this.setState('closed');
      this.o.handlers?.onError?.(
        this.handle ? new LLMError(cause.kind, `${cause.message} (gave up reconnecting)`) : cause,
      );
      return;
    }
    this.reconnects += 1;
    this.rotating = false;
    this.setState('reconnecting');
    await new Promise<void>((r) => this.setTimer(r, 400 * 2 ** (this.reconnects - 1)));
    if (this.userClosed) return;
    try {
      await this.open();
    } catch (err) {
      await this.reconnect(err instanceof LLMError ? err : new LLMError('network', 'Reconnect failed.'));
    }
  }

  private dispatch(event: LiveEvent) {
    const h = this.o.handlers;
    switch (event.type) {
      case 'audio':
        h?.onAudio?.(event.base64);
        break;
      case 'inputTranscript':
        h?.onInputTranscript?.(event.text);
        break;
      case 'outputTranscript':
        h?.onOutputTranscript?.(event.text);
        break;
      case 'interrupted':
        h?.onInterrupted?.();
        break;
      case 'turnComplete':
        h?.onTurnComplete?.();
        if (this.rotating && this.handle) this.rotateNow();
        break;
      case 'toolCall':
        void this.runTools(event.calls);
        break;
      case 'toolCancel':
        for (const id of event.ids) this.active.get(id)?.abort();
        break;
      case 'resumption':
        if (event.resumable && event.handle) {
          this.handle = event.handle;
          if (this.rotating) this.rotateNow();
        }
        break;
      case 'goAway': {
        // The server will end this connection soon. Move to a new one at a quiet moment
        // (after the current reply) but never later than just before the deadline.
        this.rotating = true;
        const deadline = Math.max(0, (event.timeLeftMs ?? 10_000) - 3_000);
        if (this.rotateTimer) this.clearTimer(this.rotateTimer);
        this.rotateTimer = this.setTimer(() => this.rotateNow(), deadline);
        break;
      }
      case 'error':
        h?.onError?.(new LLMError('invalid', event.message));
        break;
      case 'setupComplete':
        break;
    }
  }

  private rotateNow() {
    if (!this.rotating || !this.handle || !this.ws) return;
    if (this.rotateTimer) {
      this.clearTimer(this.rotateTimer);
      this.rotateTimer = null;
    }
    const old = this.ws;
    this.cancelTools();
    // Detach before closing so the old socket's close event is ignored, then resume on a new one.
    this.ws = null;
    old.onclose = null;
    old.onmessage = null;
    try {
      old.close(NORMAL_CLOSE, 'rotating');
    } catch {
      // already closed
    }
    void this.reconnect(new LLMError('network', 'Connection rotated.'));
  }

  private cancelTools() {
    for (const c of this.active.values()) c.abort();
    this.active.clear();
  }

  private async runTools(calls: LiveFunctionCall[]) {
    const results = await Promise.all(calls.map((c) => this.runOne(c)));
    // A cancelled call must not be answered; drop those results.
    const answered = results.filter((r): r is FunctionResult => r !== null);
    if (answered.length && this.state === 'ready') this.send(toolResponseMessage(answered));
  }

  private async runOne(call: LiveFunctionCall): Promise<FunctionResult | null> {
    const h = this.o.handlers;
    const tool = this.toolByName.get(call.name);
    h?.onToolStart?.(call);
    const finish = (output: string, isError = false): FunctionResult => {
      const result = { id: call.id, name: call.name, output, isError };
      h?.onToolEnd?.(call, result);
      return result;
    };
    if (!tool) return finish(`Unknown tool "${call.name}".`, true);

    if (tool.needsApproval) {
      const description = tool.describe?.(call.args) ?? `${call.name}`;
      let allowed = false;
      try {
        allowed = (await this.o.approve?.({ name: call.name, args: call.args, description })) ?? false;
      } catch {
        allowed = false;
      }
      if (!allowed) return finish('The user declined to run this action.', true);
    }

    const abort = new AbortController();
    this.active.set(call.id, abort);
    try {
      const output = await tool.execute(call.args, { signal: abort.signal });
      if (abort.signal.aborted) return null;
      return finish(output);
    } catch (err) {
      if (abort.signal.aborted) return null;
      return finish(err instanceof Error ? err.message : String(err), true);
    } finally {
      this.active.delete(call.id);
    }
  }

  private send(message: object) {
    if (this.ws && (this.state === 'ready' || this.state === 'connecting')) this.ws.send(JSON.stringify(message));
  }

  /** Streams microphone audio (base64 16 kHz PCM). Dropped while not connected. */
  sendAudio(base64: string): void {
    if (this.state === 'ready') this.ws?.send(JSON.stringify(audioChunkMessage(base64)));
  }

  /** Tells the server the mic stream paused (e.g. the user muted). */
  endAudioStream(): void {
    if (this.state === 'ready') this.ws?.send(JSON.stringify(audioStreamEndMessage()));
  }

  sendText(text: string): void {
    if (this.state === 'ready') this.ws?.send(JSON.stringify(textMessage(text)));
  }

  close(): void {
    this.userClosed = true;
    this.rotating = false;
    if (this.rotateTimer) this.clearTimer(this.rotateTimer);
    this.cancelTools();
    const ws = this.ws;
    this.ws = null;
    this.setState('closed');
    try {
      ws?.close(NORMAL_CLOSE, 'client closed');
    } catch {
      // already closed
    }
  }
}
