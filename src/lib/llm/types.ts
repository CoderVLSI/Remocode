/**
 * Provider-agnostic types shared by every model backend (cloud BYOK and local).
 * Nothing in this file may import native modules so it stays unit-testable.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
};

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Opaque provider data that must be echoed back on the next request
   * (e.g. Gemini `thoughtSignature`). Never shown to the user.
   */
  providerMeta?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on `tool` messages: which call this answers. */
  toolCallId?: string;
  toolName?: string;
  createdAt: number;
  /** Which model produced an assistant message. */
  modelId?: string;
  /** Set when generation failed; the text is user-facing. */
  error?: string;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; call: ToolCall }
  | { type: 'done' };

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  system?: string;
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: ProviderId;
  generate(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'custom'
  | 'local';

export type LLMErrorKind =
  | 'quota' // rate limit / out of credits / plan quota
  | 'auth' // missing or rejected API key
  | 'network'
  | 'invalid' // bad request, unsupported model, content blocked
  | 'aborted'
  | 'unknown';

export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly status?: number;
  /** Seconds until the quota resets, when the provider tells us. */
  readonly retryAfter?: number;

  constructor(
    kind: LLMErrorKind,
    message: string,
    extra: { status?: number; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = extra.status;
    this.retryAfter = extra.retryAfter;
  }
}

/** A selectable model in the picker. `id` is `<providerId>:<modelName>`. */
export interface ModelOption {
  id: string;
  providerId: ProviderId;
  /** Name sent to the provider API (or local model catalog id). */
  model: string;
  label: string;
  /** Supports function calling, so connectors/GitHub tools can be offered. */
  tools: boolean;
}

export function makeModelId(providerId: ProviderId, model: string): string {
  return `${providerId}:${model}`;
}

export function parseModelId(id: string): { providerId: ProviderId; model: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return { providerId: id.slice(0, i) as ProviderId, model: id.slice(i + 1) };
}
