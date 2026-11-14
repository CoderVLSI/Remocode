import type { ChatMessage } from './types';

/** Rough token estimate (~3.5 chars/token for English); errs on the high side. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5) + 4;
}

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Builds the message list for an on-device model and trims the oldest turns so
 * prompt + reply fit the context window. The system prompt and the newest user
 * message are always kept; the newest message is hard-truncated if it alone is
 * too large.
 */
export function fitToContext(
  messages: ChatMessage[],
  system: string | undefined,
  contextTokens: number,
  replyTokens: number,
): LocalChatMessage[] {
  const budget = Math.max(256, contextTokens - replyTokens);
  const turns: LocalChatMessage[] = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const head: LocalChatMessage[] = system ? [{ role: 'system', content: system }] : [];
  let used = head.reduce((n, m) => n + estimateTokens(m.content), 0);

  if (used > budget / 2) {
    // A huge system prompt (e.g. lots of attached context) must not starve the conversation.
    const maxChars = Math.floor((budget / 2) * 3.5);
    head[0] = { role: 'system', content: head[0].content.slice(0, maxChars) + '\n…[context truncated to fit the on-device model]' };
    used = estimateTokens(head[0].content);
  }

  const kept: LocalChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content);
    if (used + cost > budget) {
      if (kept.length === 0) {
        const room = Math.max(1, Math.floor((budget - used) * 3.5) - 16);
        kept.unshift({ ...turns[i], content: turns[i].content.slice(-room) });
      }
      break;
    }
    kept.unshift(turns[i]);
    used += cost;
  }

  // Chat templates expect the conversation to start with a user turn.
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift();
  return [...head, ...kept];
}
