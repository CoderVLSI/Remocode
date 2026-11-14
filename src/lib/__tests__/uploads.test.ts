import { classifyUpload, isProbablyTextFile, looksLikeText, MAX_UPLOAD_BYTES } from '../uploads';

describe('looksLikeText', () => {
  it('accepts normal and empty text, rejects NUL bytes and decode garbage', () => {
    expect(looksLikeText('hello\nworld')).toBe(true);
    expect(looksLikeText('')).toBe(true);
    expect(looksLikeText('a\u0000b')).toBe(false);
    expect(looksLikeText('�'.repeat(50) + 'x'.repeat(50))).toBe(false);
  });
});

describe('classifyUpload', () => {
  it('accepts a text file', () => {
    expect(classifyUpload({ name: 'a.ts', size: 10 }, 'const a = 1;')).toEqual({ ok: true, name: 'a.ts', content: 'const a = 1;' });
  });
  it('rejects files over the size limit before reading', () => {
    const r = classifyUpload({ name: 'a.txt', size: MAX_UPLOAD_BYTES + 1 }, null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/Too large/);
  });
  it('rejects binaries by content and by type', () => {
    expect(classifyUpload({ name: 'a.txt', size: 3 }, 'a\u0000b').ok).toBe(false);
    const img = classifyUpload({ name: 'photo.png', mimeType: 'image/png', size: 100 }, null);
    expect(!img.ok && img.reason).toMatch(/text and code/);
  });
  it('reports unreadable content', () => {
    const r = classifyUpload({ name: 'a.md', size: 3 }, null);
    expect(!r.ok && r.reason).toMatch(/Could not read/);
  });
  it('catches oversized content when size metadata is missing', () => {
    const r = classifyUpload({ name: 'a.txt' }, 'x'.repeat(MAX_UPLOAD_BYTES + 1));
    expect(r.ok).toBe(false);
  });
});

describe('isProbablyTextFile', () => {
  it.each([
    [{ name: 'README.md' }, true],
    [{ name: 'main.rs' }, true],
    [{ name: 'data', mimeType: 'application/json' }, true],
    [{ name: 'notes', mimeType: 'text/plain' }, true],
    [{ name: 'photo.jpg', mimeType: 'image/jpeg' }, false],
    [{ name: 'archive.zip' }, false],
  ])('%j -> %s', (file, expected) => {
    expect(isProbablyTextFile(file)).toBe(expected);
  });
});
