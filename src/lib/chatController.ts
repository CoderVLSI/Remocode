import { create } from 'zustand';

import { useChat, newMessageId } from '@/store/chat';
import { DEFAULT_SYSTEM_PROMPT, useSettings } from '@/store/settings';

import { buildTools } from './connectors/runtime';
import { runTurn } from './llm/agent';
import type { RunTurnResult } from './llm/agent';
import { resolveSelection } from './llm/modelOptions';
import { currentModelOptions, getProvider } from './llm/registry';
import { LLMError } from './llm/types';
import type { ChatMessage, LLMErrorKind } from './llm/types';
import { buildSystemPrompt } from './projects';

interface ActiveRun {
  produced: ChatMessage[];
  abort: AbortController;
}

interface RuntimeState {
  runs: Record<string, ActiveRun | undefined>;
  /** Most recent failure per conversation, for the banner. Cleared on the next send. */
  errors: Record<string, { kind: LLMErrorKind; message: string } | undefined>;
  setRun(id: string, run: ActiveRun | undefined): void;
  setError(id: string, error: { kind: LLMErrorKind; message: string } | undefined): void;
}

export const useRuntime = create<RuntimeState>((set, get) => ({
  runs: {},
  errors: {},
  setRun: (id, run) => set({ runs: { ...get().runs, [id]: run } }),
  setError: (id, error) => set({ errors: { ...get().errors, [id]: error } }),
}));

export function stopGeneration(conversationId: string): void {
  useRuntime.getState().runs[conversationId]?.abort.abort();
}

export interface SendOptions {
  /** Called with everything produced so far on every update (used for voice streaming). */
  onProduced?: (produced: ChatMessage[]) => void;
}

/**
 * Sends a user message and runs the model (with tools) to completion. Streaming
 * output lives in the runtime store and is committed to the persisted
 * conversation once, at the end, so token updates never hit disk.
 */
export async function sendMessage(conversationId: string, text: string, options: SendOptions = {}): Promise<RunTurnResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const runtime = useRuntime.getState();
  if (runtime.runs[conversationId]) return null; // already generating

  const chat = useChat.getState();
  const conversation = chat.conversations.find((c) => c.id === conversationId);
  if (!conversation) return null;

  runtime.setError(conversationId, undefined);

  const option = resolveSelection(currentModelOptions(), useSettings.getState().selectedModelId);
  const userMessage: ChatMessage = { id: newMessageId(), role: 'user', content: trimmed, createdAt: Date.now() };
  chat.appendMessages(conversationId, [userMessage]);

  if (!option) {
    const err = new LLMError('invalid', 'No model is available. Add an API key or download an on-device model in Settings → Models.');
    useChat.getState().appendMessages(conversationId, [
      { id: newMessageId(), role: 'assistant', content: '', createdAt: Date.now(), error: err.message },
    ]);
    runtime.setError(conversationId, { kind: err.kind, message: err.message });
    return { produced: [], error: err };
  }

  const abort = new AbortController();
  useRuntime.getState().setRun(conversationId, { produced: [], abort });

  let result: RunTurnResult;
  try {
    const project = useChat.getState().projects.find((p) => p.id === conversation.projectId) ?? null;
    const [provider, tools] = await Promise.all([getProvider(option.providerId), buildTools(project, option.tools)]);
    const history = useChat.getState().conversations.find((c) => c.id === conversationId)?.messages ?? [userMessage];

    result = await runTurn({
      provider,
      model: option.model,
      modelId: option.id,
      history,
      system: buildSystemPrompt(useSettings.getState().systemPrompt || DEFAULT_SYSTEM_PROMPT, project),
      tools,
      signal: abort.signal,
      newId: newMessageId,
      onUpdate: (produced) => {
        useRuntime.getState().setRun(conversationId, { produced, abort });
        options.onProduced?.(produced);
      },
    });
  } catch (raw) {
    // Failures before streaming starts (missing key, provider setup, tool setup).
    const err = raw instanceof LLMError ? raw : new LLMError('unknown', raw instanceof Error ? raw.message : String(raw));
    result = {
      produced: [{ id: newMessageId(), role: 'assistant', content: '', createdAt: Date.now(), modelId: option.id, error: err.message }],
      error: err,
    };
  }

  if (result.produced.length) useChat.getState().appendMessages(conversationId, result.produced);
  useRuntime.getState().setRun(conversationId, undefined);
  if (result.error && result.error.kind !== 'aborted') {
    useRuntime.getState().setError(conversationId, { kind: result.error.kind, message: result.error.message });
  }
  return result;
}

/** Re-runs the last user message after a failure by dropping the failed reply. */
export async function retryLast(conversationId: string): Promise<void> {
  const conv = useChat.getState().conversations.find((c) => c.id === conversationId);
  if (!conv || useRuntime.getState().runs[conversationId]) return;
  let lastUserIdx = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return;
  const last = conv.messages[lastUserIdx];
  useChat.getState().truncateFrom(conversationId, last.id);
  await sendMessage(conversationId, last.content);
}
