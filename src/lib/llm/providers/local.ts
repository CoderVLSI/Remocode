import { Platform } from 'react-native';

import { errorFromException } from '../errors';
import { fitToContext } from '../localContext';
import { LLMError } from '../types';
import type { GenerateOptions, LLMProvider, StreamChunk } from '../types';

type LlamaContextLike = {
  completion(
    params: Record<string, unknown>,
    cb?: (data: { token: string }) => void,
  ): Promise<unknown>;
  stopCompletion(): Promise<void>;
  release(): Promise<void>;
};

let loaded: { path: string; ctx: LlamaContextLike; contextTokens: number } | null = null;
let loading: Promise<void> | null = null;

const DEFAULT_CONTEXT = 4096;
const DEFAULT_REPLY = 1024;

async function ensureLoaded(path: string, contextTokens: number): Promise<NonNullable<typeof loaded>> {
  if (loaded && loaded.path === path) return loaded;
  // Serialise loads so two quick requests do not initialise the model twice.
  while (loading) await loading;
  if (loaded && loaded.path === path) return loaded;

  let done!: () => void;
  loading = new Promise<void>((r) => (done = r));
  try {
    if (loaded) {
      await loaded.ctx.release().catch(() => {});
      loaded = null;
    }
    const { initLlama } = await import('llama.rn');
    const ctx = (await initLlama({
      model: path,
      n_ctx: contextTokens,
      // Metal on iOS; the CPU path is the portable default on Android.
      n_gpu_layers: Platform.OS === 'ios' ? 99 : 0,
      use_mlock: false,
    })) as unknown as LlamaContextLike;
    loaded = { path, ctx, contextTokens };
    return loaded;
  } catch (err) {
    throw new LLMError(
      'invalid',
      `Could not load the on-device model: ${err instanceof Error ? err.message : String(err)}. It may need more free memory; try a smaller model.`,
    );
  } finally {
    loading = null;
    done();
  }
}

export async function unloadLocalModel(): Promise<void> {
  if (loaded) {
    const l = loaded;
    loaded = null;
    await l.ctx.release().catch(() => {});
  }
}

/** Wraps a callback-style token source as an async iterable. */
function tokenQueue() {
  const items: string[] = [];
  let finished = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(t: string) {
      items.push(t);
      notify();
    },
    end(err?: unknown) {
      finished = true;
      failure = err ?? null;
      notify();
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      while (true) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        if (finished) {
          if (failure) throw failure;
          return;
        }
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

export function createLocalProvider(deps: {
  /** Resolves a catalog id to an installed file path, or null if not downloaded. */
  resolvePath(modelId: string): { path: string; contextTokens: number } | null;
}): LLMProvider {
  return {
    id: 'local',
    async *generate(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      const found = deps.resolvePath(options.model);
      if (!found) {
        throw new LLMError('invalid', 'This on-device model is not downloaded. Open Settings → Models to install it.');
      }
      const contextTokens = Math.min(found.contextTokens || DEFAULT_CONTEXT, 8192);
      const reply = Math.min(options.maxTokens ?? DEFAULT_REPLY, Math.floor(contextTokens / 2));
      const { ctx } = await ensureLoaded(found.path, contextTokens);

      const messages = fitToContext(options.messages, options.system, contextTokens, reply);
      const queue = tokenQueue();
      const onAbort = () => {
        ctx.stopCompletion().catch(() => {});
      };
      options.signal?.addEventListener('abort', onAbort);

      ctx
        .completion(
          {
            messages,
            n_predict: reply,
            temperature: options.temperature ?? 0.7,
            // Ask templates that support it (e.g. Qwen3) not to emit <think> blocks.
            enable_thinking: false,
          },
          (data) => {
            if (data.token) queue.push(data.token);
          },
        )
        .then(() => queue.end())
        .catch((e) => queue.end(e));

      try {
        for await (const token of queue) {
          if (options.signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
          }
          yield { type: 'text', text: token };
        }
      } catch (err) {
        throw errorFromException(err);
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
      }
      yield { type: 'done' };
    },
  };
}
