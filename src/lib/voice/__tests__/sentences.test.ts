import { SentenceChunker, speakable } from '../sentences';

function run(chunker: SentenceChunker, parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) out.push(...chunker.push(p));
  const rest = chunker.flush();
  if (rest) out.push(rest);
  return out;
}

describe('speakable', () => {
  it('removes markdown that sounds wrong aloud', () => {
    expect(speakable('## Title\n- **bold** and `code` with [a link](https://x.io)')).toBe('Title bold and code with a link');
    expect(speakable('See https://example.com/path now')).toBe('See link now');
  });
  it('replaces code fences', () => {
    expect(speakable('Before ```js\nconst a = 1;\n``` after')).toBe('Before (code omitted) after');
  });
});

describe('SentenceChunker', () => {
  it('emits sentences as soon as they complete, across arbitrary token splits', () => {
    const c = new SentenceChunker();
    const first = [...c.push('The quick brown fox jumps'), ...c.push(' over the lazy dog. Then it'), ...c.push(' ran away quickly! Done')];
    expect(first).toEqual(['The quick brown fox jumps over the lazy dog.', 'Then it ran away quickly!']);
    expect(c.flush()).toBe('Done');
  });

  it('does not split decimals or abbreviations-in-progress at the end of the buffer', () => {
    const out = run(new SentenceChunker(), ['The value is 3.', '5 percent today, which is fine. Next one is ready']);
    expect(out[0]).toBe('The value is 3.5 percent today, which is fine.');
  });

  it('merges very short sentences so speech is not choppy', () => {
    const out = run(new SentenceChunker(), ['Yes. No. Maybe so, we will find out later. Ok']);
    expect(out[0]).toBe('Yes. No. Maybe so, we will find out later.');
  });

  it('holds back code fences until they close', () => {
    const c = new SentenceChunker();
    expect(c.push('Here is the code: ```js\nconst a = 1. b = 2.\n')).toEqual([]);
    const out = [...c.push('``` That is all for this example. Bye')];
    expect(out.join(' ')).toContain('(code omitted)');
    expect(out.join(' ')).not.toContain('const a');
  });

  it('force-cuts a very long run without punctuation so speech never stalls', () => {
    const long = 'word '.repeat(100);
    const out = new SentenceChunker().push(long);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].length).toBeLessThanOrEqual(280);
  });

  it('returns null on flush when nothing is pending', () => {
    expect(new SentenceChunker().flush()).toBeNull();
  });
});
