/**
 * Read-only Google Workspace REST helpers (Calendar, Drive, Docs, Sheets).
 * Auth is injected so these stay testable; see googleAuth.ts for OAuth.
 */
export interface GoogleResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
export type GoogleFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<GoogleResponse>;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
}

const MAX_DOC_CHARS = 30_000;

/** Escapes a value for use inside a Drive query string literal. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Flattens a Google Docs `documents.get` body into plain text. */
export function flattenDoc(doc: any): string {
  const out: string[] = [];
  const walk = (elements: any[] | undefined) => {
    for (const el of elements ?? []) {
      if (el.paragraph) {
        const line = (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? '').join('');
        out.push(line.replace(/\n$/, ''));
      } else if (el.table) {
        for (const row of el.table.tableRows ?? []) {
          const cells = (row.tableCells ?? []).map((c: any) => {
            const inner: string[] = [];
            for (const ce of c.content ?? []) {
              if (ce.paragraph) {
                inner.push((ce.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? '').join('').trim());
              }
            }
            return inner.join(' ');
          });
          out.push(cells.join(' | '));
        }
      }
    }
  };
  walk(doc?.body?.content);
  const text = out.join('\n').trim();
  return text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n…[truncated]` : text;
}

export function formatEvent(e: any): string {
  const start = e.start?.dateTime ?? e.start?.date ?? '?';
  const end = e.end?.dateTime ?? e.end?.date ?? '';
  const where = e.location ? ` @ ${e.location}` : '';
  return `- ${start}${end ? ` → ${end}` : ''}: ${e.summary ?? '(no title)'}${where}`;
}


export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';

/** Largest Drive file we will download as text. */
export const MAX_DRIVE_TEXT_BYTES = 500 * 1024;

export function isFolder(e: Pick<DriveEntry, 'mimeType'>): boolean {
  return e.mimeType === FOLDER_MIME;
}

/** True for files we can turn into text: Google Docs/Sheets/Slides plus plain text and code. */
export function isReadableDriveFile(e: Pick<DriveEntry, 'mimeType' | 'name'>): boolean {
  if ([DOC_MIME, SHEET_MIME, SLIDES_MIME].includes(e.mimeType)) return true;
  if (e.mimeType.startsWith('text/')) return true;
  if (['application/json', 'application/xml', 'application/javascript', 'application/x-yaml'].includes(e.mimeType)) return true;
  return /\.(md|txt|csv|tsv|json|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|sh|sql|ini|env|log)$/i.test(e.name);
}

/** Drive ids are URL-safe tokens; reject anything else before it reaches a URL or query. */
export function assertDriveId(id: string): string {
  if (id !== 'root' && !/^[\w-]{10,}$/.test(id)) throw new GoogleError('Invalid Drive id.');
  return id;
}

export function createGoogleClient(getToken: () => Promise<string>, fetchImpl: GoogleFetch) {
  async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
    const token = await getToken();
    let res: GoogleResponse;
    try {
      res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal });
    } catch (err) {
      throw new GoogleError(`Could not reach Google: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      if (res.status === 401) throw new GoogleError('Google access expired. Reconnect Google in Customizations.', 401);
      if (res.status === 403) throw new GoogleError('Google denied access to this resource or API.', 403);
      if (res.status === 404) throw new GoogleError('Not found.', 404);
      throw new GoogleError(`Google error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    async upcomingEvents(days: number, now = new Date(), signal?: AbortSignal): Promise<string> {
      const span = Math.min(Math.max(Math.floor(days) || 7, 1), 31);
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + span * 86_400_000).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '25',
      });
      const json = await get<{ items?: any[] }>(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
        signal,
      );
      const items = json.items ?? [];
      return items.length ? items.map(formatEvent).join('\n') : `No events in the next ${span} day(s).`;
    },

    async driveSearch(query: string, signal?: AbortSignal): Promise<string> {
      const q = query.trim();
      if (!q) throw new GoogleError('A search query is required.');
      const params = new URLSearchParams({
        q: `fullText contains '${escapeDriveQuery(q)}' and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime)',
        pageSize: '10',
        orderBy: 'modifiedTime desc',
      });
      const json = await get<{ files?: any[] }>(`https://www.googleapis.com/drive/v3/files?${params}`, signal);
      const files = json.files ?? [];
      return files.length
        ? files.map((f) => `- ${f.name} (id: ${f.id}, ${f.mimeType}, modified ${f.modifiedTime})`).join('\n')
        : 'No matching files.';
    },


    /** Lists a folder (folders first). `root` is My Drive. */
    async listFolder(folderId: string, signal?: AbortSignal): Promise<DriveEntry[]> {
      const id = assertDriveId(folderId);
      const params = new URLSearchParams({
        q: `'${id}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,size,modifiedTime)',
        pageSize: '100',
        orderBy: 'folder,name',
      });
      const json = await get<{ files?: any[] }>(`https://www.googleapis.com/drive/v3/files?${params}`, signal);
      return (json.files ?? []).map((f) => ({
        id: f.id as string,
        name: f.name as string,
        mimeType: f.mimeType as string,
        size: f.size !== undefined ? Number(f.size) : undefined,
        modifiedTime: f.modifiedTime as string | undefined,
      }));
    },

    async getEntry(fileId: string, signal?: AbortSignal): Promise<DriveEntry & { parents: string[] }> {
      const id = assertDriveId(fileId);
      const f = await get<any>(
        `https://www.googleapis.com/drive/v3/files/${id}?fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime,parents')}`,
        signal,
      );
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size !== undefined ? Number(f.size) : undefined,
        modifiedTime: f.modifiedTime,
        parents: f.parents ?? [],
      };
    },

    /** Whether `fileId` sits (at any depth up to `maxDepth`) inside `folderId`. */
    async isInsideFolder(fileId: string, folderId: string, maxDepth = 8, signal?: AbortSignal): Promise<boolean> {
      let frontier = [assertDriveId(fileId)];
      const seen = new Set<string>();
      for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
        const next: string[] = [];
        for (const id of frontier) {
          if (seen.has(id)) continue;
          seen.add(id);
          let entry;
          try {
            entry = await this.getEntry(id, signal);
          } catch (err) {
            // An ancestor the token cannot read (or that no longer exists) is a dead end for this
            // branch, not a failure: another parent may still lead to the folder. Fail closed
            // overall, but let auth/network errors surface.
            if (err instanceof GoogleError && (err.status === 404 || err.status === 403)) continue;
            throw err;
          }
          for (const parent of entry.parents) {
            if (parent === folderId) return true;
            next.push(parent);
          }
        }
        frontier = next;
      }
      return false;
    },

    /** Returns the file as text: Docs/Slides export as plain text, Sheets as CSV, text files as-is. */
    async readFileText(entry: Pick<DriveEntry, 'id' | 'mimeType' | 'name' | 'size'>, signal?: AbortSignal): Promise<string> {
      const id = assertDriveId(entry.id);
      if (!isReadableDriveFile(entry)) {
        throw new GoogleError(`${entry.name} is not a text-readable file type (${entry.mimeType}).`);
      }
      const google = entry.mimeType.startsWith('application/vnd.google-apps.');
      if (!google && entry.size !== undefined && entry.size > MAX_DRIVE_TEXT_BYTES) {
        throw new GoogleError(`${entry.name} is too large (${Math.round(entry.size / 1024)} KB).`);
      }
      const url = google
        ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(entry.mimeType === SHEET_MIME ? 'text/csv' : 'text/plain')}`
        : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
      const token = await getToken();
      let res: GoogleResponse;
      try {
        res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal });
      } catch (err) {
        throw new GoogleError(`Could not reach Google: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        if (res.status === 401) throw new GoogleError('Google access expired. Reconnect Google in Customizations.', 401);
        if (res.status === 403) throw new GoogleError('Google denied access to this file.', 403);
        throw new GoogleError(`Could not read ${entry.name} (HTTP ${res.status}).`, res.status);
      }
      const text = await res.text();
      if (text.includes('\u0000')) throw new GoogleError(`${entry.name} looks like a binary file.`);
      return text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n…[truncated]` : text;
    },

    async readDoc(fileId: string, signal?: AbortSignal): Promise<string> {
      if (!/^[\w-]{10,}$/.test(fileId)) throw new GoogleError('Invalid document id.');
      const doc = await get<any>(`https://docs.googleapis.com/v1/documents/${fileId}`, signal);
      return `# ${doc.title ?? 'Untitled'}\n\n${flattenDoc(doc)}`;
    },

    async readSheet(spreadsheetId: string, range: string, signal?: AbortSignal): Promise<string> {
      if (!/^[\w-]{10,}$/.test(spreadsheetId)) throw new GoogleError('Invalid spreadsheet id.');
      const r = range.trim() || 'A1:Z100';
      const json = await get<{ values?: string[][] }>(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(r)}`,
        signal,
      );
      const rows = json.values ?? [];
      return rows.length ? rows.map((row) => row.join('\t')).join('\n') : 'The range is empty.';
    },
  };
}

export type GoogleClient = ReturnType<typeof createGoogleClient>;
