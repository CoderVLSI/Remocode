import { buildSystemPrompt } from '../../projects';
import type { Project } from '../../projects';
import { cleanPath, createGitHubClient, isValidRepo, GitHubError } from '../github';
import type { GitHubFetch } from '../github';
import { createGoogleClient, escapeDriveQuery, flattenDoc, GoogleError } from '../google';
import type { GoogleFetch } from '../google';
import { githubTools, googleTools } from '../tools';

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => init.headers?.[n.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

describe('github paths and repos', () => {
  it('validates repo names', () => {
    expect(isValidRepo('owner/name')).toBe(true);
    expect(isValidRepo('a/b/c')).toBe(false);
    expect(isValidRepo('owner/..')).toBe(false);
    expect(isValidRepo('nope')).toBe(false);
  });
  it('cleans paths and rejects traversal', () => {
    expect(cleanPath('/src/lib/')).toBe('src/lib');
    expect(cleanPath('')).toBe('');
    expect(() => cleanPath('a/../b')).toThrow(GitHubError);
    expect(() => cleanPath('a//b')).toThrow(GitHubError);
  });
});

describe('github client', () => {
  it('lists a directory with dirs first and sends auth headers', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const f: GitHubFetch = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return res([
        { name: 'b.ts', path: 'src/b.ts', type: 'file', size: 10 },
        { name: 'lib', path: 'src/lib', type: 'dir', size: 0 },
        { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 5 },
      ]);
    };
    const gh = createGitHubClient('tok', f);
    const entries = await gh.listDir('o/r', 'src', 'dev');
    expect(entries.map((e) => e.name)).toEqual(['lib', 'a.ts', 'b.ts']);
    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/contents/src?ref=dev');
    expect(calls[0].headers?.authorization).toBe('Bearer tok');
  });

  it('maps HTTP failures to friendly errors', async () => {
    const mk = (status: number, headers?: Record<string, string>) =>
      createGitHubClient('t', async () => res('x', { status, headers }));
    await expect(mk(401).getUser()).rejects.toThrow(/rejected the token/);
    await expect(mk(404).readFile('o/r', 'x')).rejects.toThrow(/Not found/);
    await expect(mk(403, { 'x-ratelimit-remaining': '0' }).searchCode('o/r', 'q')).rejects.toThrow(/rate limit/);
  });

  it('refuses binary and oversized files, and truncates long ones', async () => {
    const gh = (body: string, headers?: Record<string, string>) => createGitHubClient('t', async () => res(body, { headers }));
    await expect(gh('abc\u0000def').readFile('o/r', 'bin')).rejects.toThrow(/binary/);
    await expect(gh('x', { 'content-length': String(5 * 1024 * 1024) }).readFile('o/r', 'big')).rejects.toThrow(/too large/);
    const long = await gh('y'.repeat(250_000)).readFile('o/r', 'long');
    expect(long).toMatch(/truncated/);
    expect(long.length).toBeLessThan(205_000);
  });

  it('never lets tool calls escape the attached repo', async () => {
    const urls: string[] = [];
    const gh = createGitHubClient('t', async (url) => {
      urls.push(url);
      return res('contents');
    });
    const tools = githubTools(gh, 'owner/attached', 'main');
    const read = tools.find((t) => t.spec.name === 'github_read_file')!;
    await read.execute({ path: 'README.md', repo: 'evil/other' }, {});
    expect(urls[0]).toContain('/repos/owner/attached/');
    expect(urls[0]).not.toContain('evil');
    await expect(read.execute({ path: '../../etc/passwd' }, {})).rejects.toThrow(/Invalid path/);
    await expect(read.execute({}, {})).rejects.toThrow(/Missing required/);
  });
});

describe('google client', () => {
  const doc = {
    title: 'Plan',
    body: {
      content: [
        { paragraph: { elements: [{ textRun: { content: 'Heading\n' } }] } },
        { paragraph: { elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'world\n' } }] } },
        {
          table: {
            tableRows: [
              { tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] }] },
            ],
          },
        },
      ],
    },
  };

  it('flattens docs including tables', () => {
    expect(flattenDoc(doc)).toBe('Heading\nHello world\nA | B');
  });

  it('escapes Drive query literals', () => {
    expect(escapeDriveQuery(`it's a \\ test`)).toBe(`it\\'s a \\\\ test`);
  });

  it('builds a Drive search with the escaped query and bearer token', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const f: GoogleFetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return res({ files: [{ id: 'abc', name: "Bob's notes", mimeType: 'text/plain', modifiedTime: '2026-01-01' }] });
    };
    const g = createGoogleClient(async () => 'ya29.token', f);
    const out = await g.driveSearch("Bob's");
    expect(out).toContain("Bob's notes (id: abc");
    const q = new URL(seen[0].url).searchParams.get('q');
    expect(q).toBe("fullText contains 'Bob\\'s' and trashed = false");
    expect(seen[0].headers.authorization).toBe('Bearer ya29.token');
  });

  it('formats upcoming events and clamps the day range', async () => {
    let url = '';
    const g = createGoogleClient(
      async () => 't',
      async (u) => {
        url = u;
        return res({ items: [{ summary: 'Standup', start: { dateTime: '2026-11-14T09:00:00Z' }, end: { dateTime: '2026-11-14T09:15:00Z' }, location: 'Zoom' }] });
      },
    );
    const now = new Date('2026-11-13T00:00:00Z');
    const out = await g.upcomingEvents(999, now);
    expect(out).toBe('- 2026-11-14T09:00:00Z → 2026-11-14T09:15:00Z: Standup @ Zoom');
    const p = new URL(url).searchParams;
    expect(p.get('timeMax')).toBe(new Date(now.getTime() + 31 * 86_400_000).toISOString());
  });

  it('validates ids and maps auth errors', async () => {
    const g = createGoogleClient(async () => 't', async () => res('no', { status: 401 }));
    await expect(g.readDoc('short')).rejects.toBeInstanceOf(GoogleError);
    await expect(g.readSheet('abcdefghij12', 'A1')).rejects.toThrow(/Reconnect Google/);
    const tools = googleTools(g);
    expect(tools.map((t) => t.spec.name)).toEqual(['calendar_upcoming_events', 'drive_search', 'docs_read', 'sheets_read']);
  });
});

describe('buildSystemPrompt', () => {
  const project: Project = {
    id: 'p',
    name: 'Grid',
    instructions: 'Prefer TypeScript.',
    createdAt: 0,
    resources: [
      { id: '1', kind: 'github', repo: 'o/grid', ref: 'main' },
      { id: '2', kind: 'file', name: 'notes.md', content: 'hello notes' },
      { id: '3', kind: 'file', name: 'big.txt', content: 'z'.repeat(500) },
    ],
  };

  it('returns just the base prompt with no project', () => {
    expect(buildSystemPrompt('Base.', null)).toBe('Base.');
  });

  it('includes instructions, the attached repo, and pinned files', () => {
    const out = buildSystemPrompt('Base.', project);
    expect(out).toContain('project "Grid"');
    expect(out).toContain('Prefer TypeScript.');
    expect(out).toContain('o/grid (ref: main)');
    expect(out).toContain('### notes.md');
    expect(out).toContain('hello notes');
  });

  it('enforces the pinned-context budget', () => {
    const out = buildSystemPrompt('Base.', project, 300);
    expect(out).toContain('hello notes');
    expect(out).toMatch(/…\[truncated\]/);
    expect(out.length).toBeLessThan(1500);
    const tiny = buildSystemPrompt('Base.', project, 10);
    expect(tiny).toContain('omitted: context budget reached');
  });
});
