/**
 * Curated on-device models (GGUF, Q4_K_M) served from Hugging Face.
 * Sizes are approximate and used only for UI and free-space checks.
 * Run `node scripts/check-model-urls.mjs` to verify the URLs still resolve.
 */
export interface LocalCatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  filename: string;
  sizeBytes: number;
  contextLength: number;
  /** True for entries the user added by URL. */
  custom?: boolean;
}

const GB = 1024 * 1024 * 1024;

export const LOCAL_CATALOG: LocalCatalogEntry[] = [
  {
    id: 'gemma-3-1b-it',
    name: 'Gemma 3 1B',
    description: 'Fast and light. Good for quick answers on most phones.',
    url: 'https://huggingface.co/unsloth/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf',
    filename: 'gemma-3-1b-it-Q4_K_M.gguf',
    sizeBytes: 0.8 * GB,
    contextLength: 4096,
  },
  {
    id: 'llama-3.2-1b-instruct',
    name: 'Llama 3.2 1B',
    description: 'Small general-purpose chat model.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 0.81 * GB,
    contextLength: 4096,
  },
  {
    id: 'qwen2.5-1.5b-instruct',
    name: 'Qwen 2.5 1.5B',
    description: 'Strong for its size, including code and multilingual text.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1.1 * GB,
    contextLength: 4096,
  },
  {
    id: 'llama-3.2-3b-instruct',
    name: 'Llama 3.2 3B',
    description: 'Better quality; needs a recent phone with 6 GB+ RAM.',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2.0 * GB,
    contextLength: 4096,
  },
  {
    id: 'qwen2.5-3b-instruct',
    name: 'Qwen 2.5 3B',
    description: 'Higher quality coding and reasoning; 6 GB+ RAM recommended.',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    sizeBytes: 2.1 * GB,
    contextLength: 4096,
  },
  {
    id: 'phi-3.5-mini-instruct',
    name: 'Phi 3.5 mini',
    description: 'Compact reasoning model; 8 GB RAM recommended.',
    url: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
    sizeBytes: 2.4 * GB,
    contextLength: 4096,
  },
];

/** Builds a catalog entry from a user-supplied direct .gguf URL. */
export function customEntryFromUrl(rawUrl: string): LocalCatalogEntry | { error: string } {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { error: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'https:') return { error: 'Use an https:// link.' };
  const filename = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (!/^[\w.\-+()]+\.gguf$/i.test(filename)) {
    return { error: 'The link must point directly to a .gguf file.' };
  }
  const id = `custom-${filename.toLowerCase().replace(/\.gguf$/, '').replace(/[^a-z0-9.\-]+/g, '-')}`;
  return {
    id,
    name: filename.replace(/\.gguf$/i, ''),
    description: 'Custom model from URL.',
    url: url.toString(),
    filename,
    sizeBytes: 0,
    contextLength: 4096,
    custom: true,
  };
}
