/**
 * Gemini Live API (BidiGenerateContent over WebSocket): message builders and parser.
 * Shapes follow Google's official @google/genai SDK. Pure, so it is unit-testable.
 */
import type { JsonSchema, ToolSpec } from '../llm/types';

export const LIVE_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Audio the model sends back: 16-bit little-endian mono PCM at this rate. */
export const OUTPUT_SAMPLE_RATE = 24_000;
/** Audio we send: 16-bit little-endian mono PCM at this rate. */
export const INPUT_SAMPLE_RATE = 16_000;
export const INPUT_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;

/** Voices offered in Settings (Gemini prebuilt voices). */
export const LIVE_VOICES = ['Puck', 'Kore', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'] as const;

export function liveUrl(apiKey: string): string {
  return `${LIVE_WS_URL}?key=${encodeURIComponent(apiKey)}`;
}

/** Gemini's schema enums are upper-case (OBJECT, STRING, …). */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) out.type = schema.type.toUpperCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.required?.length) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  return out;
}

export interface LiveSetupOptions {
  model: string;
  systemInstruction?: string;
  tools?: ToolSpec[];
  voiceName?: string;
  /** Handle from a previous session so a dropped connection can continue where it left off. */
  resumptionHandle?: string | null;
}

export function buildSetupMessage(o: LiveSetupOptions): { setup: Record<string, unknown> } {
  const setup: Record<string, unknown> = {
    model: o.model.startsWith('models/') ? o.model : `models/${o.model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName ?? 'Puck' } } },
    },
    // Transcripts let us save the conversation as text and show captions.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // Lets sessions run past the default audio length limit by trimming old context.
    contextWindowCompression: { slidingWindow: {} },
    // Always ask for resumption handles so we can reconnect after a GoAway or a dropped network.
    sessionResumption: o.resumptionHandle ? { handle: o.resumptionHandle } : {},
  };
  if (o.systemInstruction) setup.systemInstruction = { parts: [{ text: o.systemInstruction }] };
  if (o.tools?.length) {
    setup.tools = [
      {
        functionDeclarations: o.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: toGeminiSchema(t.parameters),
        })),
      },
    ];
  }
  return { setup };
}

export const audioChunkMessage = (base64: string) => ({ realtimeInput: { audio: { data: base64, mimeType: INPUT_MIME } } });
export const audioStreamEndMessage = () => ({ realtimeInput: { audioStreamEnd: true } });
export const textMessage = (text: string) => ({ realtimeInput: { text } });

export interface FunctionResult {
  id: string;
  name: string;
  /** Text for the model. Errors are reported as `{ error }` so the model can recover. */
  output: string;
  isError?: boolean;
}

export function toolResponseMessage(results: FunctionResult[]) {
  return {
    toolResponse: {
      functionResponses: results.map((r) => ({
        id: r.id,
        name: r.name,
        response: r.isError ? { error: r.output } : { output: r.output },
      })),
    },
  };
}

export interface LiveFunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LiveEvent =
  | { type: 'setupComplete' }
  | { type: 'audio'; base64: string; mimeType: string }
  | { type: 'inputTranscript'; text: string }
  | { type: 'outputTranscript'; text: string }
  | { type: 'turnComplete' }
  | { type: 'interrupted' }
  | { type: 'toolCall'; calls: LiveFunctionCall[] }
  | { type: 'toolCancel'; ids: string[] }
  | { type: 'goAway'; timeLeftMs?: number }
  | { type: 'resumption'; handle: string | null; resumable: boolean }
  | { type: 'error'; message: string };

/** "50s" / "1.5s" -> milliseconds. */
export function parseDurationMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/** One server frame can carry several things at once (audio and a transcript, for example). */
export function parseServerMessage(raw: string): LiveEvent[] {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: LiveEvent[] = [];

  if (msg.error) {
    out.push({ type: 'error', message: msg.error.message ?? 'Live API error' });
  }
  if (msg.setupComplete) out.push({ type: 'setupComplete' });

  const sc = msg.serverContent;
  if (sc) {
    // Interruption first: audio already queued locally is stale the moment the user barges in.
    if (sc.interrupted) out.push({ type: 'interrupted' });
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        out.push({ type: 'audio', base64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? `audio/pcm;rate=${OUTPUT_SAMPLE_RATE}` });
      }
    }
    if (sc.inputTranscription?.text) out.push({ type: 'inputTranscript', text: sc.inputTranscription.text });
    if (sc.outputTranscription?.text) out.push({ type: 'outputTranscript', text: sc.outputTranscription.text });
    if (sc.turnComplete) out.push({ type: 'turnComplete' });
  }

  if (msg.toolCall?.functionCalls?.length) {
    out.push({
      type: 'toolCall',
      calls: msg.toolCall.functionCalls.map((c: any, i: number) => ({
        id: String(c.id ?? `call_${Date.now().toString(36)}_${i}`),
        name: String(c.name),
        args: (c.args ?? {}) as Record<string, unknown>,
      })),
    });
  }
  if (msg.toolCallCancellation?.ids?.length) out.push({ type: 'toolCancel', ids: msg.toolCallCancellation.ids.map(String) });
  if (msg.goAway) out.push({ type: 'goAway', timeLeftMs: parseDurationMs(msg.goAway.timeLeft) });
  if (msg.sessionResumptionUpdate) {
    const u = msg.sessionResumptionUpdate;
    out.push({ type: 'resumption', handle: u.newHandle || null, resumable: !!u.resumable });
  }
  return out;
}
