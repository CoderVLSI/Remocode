/** Validation for files the user uploads into a project. Pure (no native imports). */

/** Largest upload we will pin as context. */
export const MAX_UPLOAD_BYTES = 500 * 1024;

const TEXT_EXTENSIONS =
  /\.(md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|swift|m|mm|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|ini|cfg|conf|env|log|gradle|properties|lock|r|lua|dart|vue|svelte)$/i;

export type UploadResult = { ok: true; name: string; content: string } | { ok: false; name: string; reason: string };

/** Heuristic: text has no NUL bytes and almost no replacement characters from failed decoding. */
export function looksLikeText(content: string): boolean {
  if (content.includes('\u0000')) return false;
  if (content.length === 0) return true;
  const replacements = (content.match(/�/g) ?? []).length;
  return replacements / content.length < 0.01;
}

export function classifyUpload(file: { name: string; size?: number | null; mimeType?: string | null }, content: string | null): UploadResult {
  const name = file.name || 'file';
  if (file.size != null && file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, name, reason: `Too large (${Math.round(file.size / 1024)} KB; limit ${MAX_UPLOAD_BYTES / 1024} KB).` };
  }
  const textual = TEXT_EXTENSIONS.test(name) || (file.mimeType ?? '').startsWith('text/') || /json|xml|yaml|javascript/.test(file.mimeType ?? '');
  if (!textual && content === null) {
    return { ok: false, name, reason: 'Only text and code files are supported.' };
  }
  if (content === null) return { ok: false, name, reason: 'Could not read the file.' };
  if (!looksLikeText(content)) return { ok: false, name, reason: 'This looks like a binary file. Only text and code files are supported.' };
  if (content.length > MAX_UPLOAD_BYTES) {
    return { ok: false, name, reason: `Too large (${Math.round(content.length / 1024)} KB; limit ${MAX_UPLOAD_BYTES / 1024} KB).` };
  }
  return { ok: true, name, content };
}

/** True when the file type can be read as text, so we can skip reading obvious binaries. */
export function isProbablyTextFile(file: { name: string; mimeType?: string | null }): boolean {
  return TEXT_EXTENSIONS.test(file.name) || (file.mimeType ?? '').startsWith('text/') || /json|xml|yaml|javascript/.test(file.mimeType ?? '');
}
