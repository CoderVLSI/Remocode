/**
 * Helpers for speaking a streaming reply. Text arrives token by token; we cut
 * it into sentences so text-to-speech can start on the first one.
 */

/** Strips markdown that sounds wrong when read aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_SENTENCE_CHARS = 24;
const MAX_SENTENCE_CHARS = 280;

export class SentenceChunker {
  private buffer = '';
  private inFence = false;

  /** Feeds more text; returns any complete, speakable sentences. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    // Code fences can contain periods everywhere; hold them back until closed.
    const fences = (this.buffer.match(/```/g) ?? []).length;
    this.inFence = fences % 2 === 1;
    if (this.inFence) return out;

    while (true) {
      const cut = this.findCut();
      if (cut === -1) break;
      const sentence = speakable(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut).replace(/^\s+/, '');
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Returns whatever is left once the reply is complete. */
  flush(): string | null {
    const rest = speakable(this.buffer);
    this.buffer = '';
    this.inFence = false;
    return rest || null;
  }

  private findCut(): number {
    const re = /([.!?]+["')\]]*|\n{2,})(\s+|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buffer))) {
      const end = m.index + m[1].length;
      // A trailing terminator at the very end may be mid-token ("3." then "5"); wait for whitespace.
      if (m[2] === '' && !/\n{2,}/.test(m[1])) return -1;
      const prefix = this.buffer.slice(0, end);
      // Never cut inside a code fence, even one that has since closed.
      if ((prefix.match(/```/g) ?? []).length % 2 === 1) continue;
      if (speakable(prefix).length >= MIN_SENTENCE_CHARS) return end;
    }
    // No terminator for a long stretch: cut at the last space so speech never stalls.
    if (this.buffer.length > MAX_SENTENCE_CHARS) {
      const space = this.buffer.lastIndexOf(' ', MAX_SENTENCE_CHARS);
      return space > 0 ? space : MAX_SENTENCE_CHARS;
    }
    return -1;
  }
}
