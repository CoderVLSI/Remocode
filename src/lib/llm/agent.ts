import { describeError, errorFromException } from './errors';
import { LLMError } from './types';
import type { ChatMessage, LLMProvider, ToolCall, ToolSpec } from './types';

export interface ToolExecutor {
  spec: ToolSpec;
  /** Returns text for the model. Throwing is fine: the message is passed back to the model. */
  execute(args: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<string>;
}

export interface RunTurnParams {
  provider: LLMProvider;
  /** Name sent to the provider API. */
  model: string;
  /** Picker id stored on the assistant message (`provider:model`). */
  modelId: string;
  /** History including the newest user message. */
  history: ChatMessage[];
  system?: string;
  tools?: ToolExecutor[];
  signal?: AbortSignal;
  /** Safety cap on model<->tool round trips. */
  maxSteps?: number;
  newId: () => string;
  now?: () => number;
  /** Called with all messages produced so far this turn, on every change. */
  onUpdate?: (produced: ChatMessage[]) => void;
}

export interface RunTurnResult {
  produced: ChatMessage[];
  error?: LLMError;
}

const MAX_TOOL_OUTPUT_CHARS = 24_000;

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated ${text.length - MAX_TOOL_OUTPUT_CHARS} characters]`;
}

export async function runTurn(p: RunTurnParams): Promise<RunTurnResult> {
  const now = p.now ?? Date.now;
  const maxSteps = p.maxSteps ?? 8;
  const produced: ChatMessage[] = [];
  const emit = () => p.onUpdate?.(produced.map((m) => ({ ...m })));
  const toolByName = new Map((p.tools ?? []).map((t) => [t.spec.name, t]));
  const specs = (p.tools ?? []).map((t) => t.spec);

  for (let step = 0; step < maxSteps; step++) {
    const assistant: ChatMessage = {
      id: p.newId(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      modelId: p.modelId,
    };
    produced.push(assistant);
    emit();

    const calls: ToolCall[] = [];
    try {
      const stream = p.provider.generate({
        model: p.model,
        messages: [...p.history, ...produced.slice(0, -1)],
        system: p.system,
        tools: specs.length ? specs : undefined,
        signal: p.signal,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          assistant.content += chunk.text;
          emit();
        } else if (chunk.type === 'toolCall') {
          calls.push(chunk.call);
        }
      }
    } catch (raw) {
      const err = errorFromException(raw);
      if (err.kind === 'aborted') {
        if (!assistant.content && !calls.length) produced.pop();
        emit();
        return { produced, error: err };
      }
      assistant.error = describeError(err, now());
      emit();
      return { produced, error: err };
    }

    if (calls.length === 0) {
      if (!assistant.content) {
        // Some providers occasionally return an empty turn; surface it instead of a blank bubble.
        assistant.error = 'The model returned an empty response. Try again or pick another model.';
        emit();
        return { produced, error: new LLMError('unknown', assistant.error) };
      }
      return { produced };
    }

    assistant.toolCalls = calls;
    emit();

    for (const call of calls) {
      const tool = toolByName.get(call.name);
      let output: string;
      if (!tool) {
        output = `Error: unknown tool "${call.name}".`;
      } else {
        try {
          output = truncate(await tool.execute(call.args, { signal: p.signal }));
        } catch (err) {
          if (p.signal?.aborted) {
            emit();
            return { produced, error: new LLMError('aborted', 'Cancelled') };
          }
          output = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      produced.push({
        id: p.newId(),
        role: 'tool',
        content: output,
        toolCallId: call.id,
        toolName: call.name,
        createdAt: now(),
      });
      emit();
    }
  }

  const limit: ChatMessage = {
    id: p.newId(),
    role: 'assistant',
    content: '',
    createdAt: now(),
    modelId: p.modelId,
    error: `Stopped after ${maxSteps} tool steps. Ask me to continue if you want more.`,
  };
  produced.push(limit);
  emit();
  return { produced, error: new LLMError('unknown', limit.error!) };
}
