/**
 * Minimal read-only GitHub REST client. The token is a fine-grained or classic
 * personal access token stored in secure storage; requests are scoped to repos
 * the token can read.
 */
export interface GitHubFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}
export type GitHubFetch = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<GitHubFetchResponse>;

export interface GitHubRepo {
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
}

export interface GitHubEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'other';
  size: number;
}

const API = 'https://api.github.com';
export const MAX_FILE_BYTES = 200 * 1024;

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export function isValidRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && !repo.includes('..');
}

/** Normalises a repo-relative path and rejects traversal. */
export function cleanPath(path: string | undefined): string {
  const p = (path ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!p) return '';
  const parts = p.split('/');
  if (parts.some((s) => s === '..' || s === '.' || s === '')) throw new GitHubError(`Invalid path: ${path}`);
  return parts.join('/');
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubClient(token: string, fetchImpl: GitHubFetch) {
  async function request(url: string, accept = 'application/vnd.github+json', signal?: AbortSignal) {
    let res: GitHubFetchResponse;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept,
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal,
      });
    } catch (err) {
      throw new GitHubError(`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      if (res.status === 401) throw new GitHubError('GitHub rejected the token. Reconnect GitHub in Customizations.', 401);
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new GitHubError('GitHub rate limit reached. Try again later.', 403);
      }
      if (res.status === 404) throw new GitHubError('Not found (or the token cannot access it).', 404);
      const body = await res.text().catch(() => '');
      throw new GitHubError(`GitHub error ${res.status}: ${body.slice(0, 200)}`, res.status);
    }
    return res;
  }

  return {
    async getUser(signal?: AbortSignal): Promise<{ login: string }> {
      const res = await request(`${API}/user`, undefined, signal);
      const j = (await res.json()) as { login: string };
      return { login: j.login };
    },

    async listRepos(page = 1, signal?: AbortSignal): Promise<GitHubRepo[]> {
      const res = await request(
        `${API}/user/repos?sort=updated&per_page=50&page=${page}&affiliation=owner,collaborator,organization_member`,
        undefined,
        signal,
      );
      const rows = (await res.json()) as any[];
      return rows.map((r) => ({
        fullName: r.full_name,
        description: r.description ?? null,
        private: !!r.private,
        defaultBranch: r.default_branch ?? 'main',
        updatedAt: r.updated_at,
      }));
    },

    async listDir(repo: string, path: string, ref?: string, signal?: AbortSignal): Promise<GitHubEntry[]> {
      if (!isValidRepo(repo)) throw new GitHubError(`Invalid repository: ${repo}`);
      const p = cleanPath(path);
      const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const res = await request(`${API}/repos/${repo}/contents/${encodePath(p)}${qs}`, undefined, signal);
      const json = (await res.json()) as any;
      if (!Array.isArray(json)) throw new GitHubError(`${p || '/'} is a file, not a directory.`);
      return json
        .map((e) => ({
          name: e.name as string,
          path: e.path as string,
          type: (e.type === 'dir' ? 'dir' : e.type === 'file' ? 'file' : 'other') as GitHubEntry['type'],
          size: (e.size as number) ?? 0,
        }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    },

    async readFile(repo: string, path: string, ref?: string, signal?: AbortSignal): Promise<string> {
      if (!isValidRepo(repo)) throw new GitHubError(`Invalid repository: ${repo}`);
      const p = cleanPath(path);
      if (!p) throw new GitHubError('A file path is required.');
      const qs = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const res = await request(`${API}/repos/${repo}/contents/${encodePath(p)}${qs}`, 'application/vnd.github.raw+json', signal);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_FILE_BYTES * 4) throw new GitHubError(`File is too large (${Math.round(declared / 1024)} KB).`);
      const text = await res.text();
      if (text.includes('\u0000')) throw new GitHubError('This looks like a binary file.');
      return text.length > MAX_FILE_BYTES
        ? `${text.slice(0, MAX_FILE_BYTES)}\n…[truncated, file is ${text.length} characters]`
        : text;
    },

    async searchCode(repo: string, query: string, signal?: AbortSignal): Promise<{ path: string; url: string }[]> {
      if (!isValidRepo(repo)) throw new GitHubError(`Invalid repository: ${repo}`);
      const q = query.trim();
      if (!q) throw new GitHubError('A search query is required.');
      const res = await request(
        `${API}/search/code?q=${encodeURIComponent(`${q} repo:${repo}`)}&per_page=15`,
        undefined,
        signal,
      );
      const json = (await res.json()) as { items?: { path: string; html_url: string }[] };
      return (json.items ?? []).map((i) => ({ path: i.path, url: i.html_url }));
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;
