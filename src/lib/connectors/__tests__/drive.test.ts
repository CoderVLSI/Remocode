import { buildSystemPrompt } from '../../projects';
import type { Project } from '../../projects';
import { createGoogleClient, GoogleError, isReadableDriveFile } from '../google';
import type { GoogleFetch } from '../google';
import { driveFolderTools } from '../tools';

const FOLDER = 'folderAAAAAAAAAA';
const SUB = 'subFolderBBBBBB';
const INSIDE = 'fileInsideCCCCCC';
const OUTSIDE = 'fileOutsideDDDDD';

/** A tiny fake Drive: id -> metadata, plus content by id. */
const tree: Record<string, { name: string; mimeType: string; parents: string[]; size?: number; content?: string }> = {
  [FOLDER]: { name: 'Specs', mimeType: 'application/vnd.google-apps.folder', parents: ['rootRootRoot0'] },
  [SUB]: { name: 'Sub', mimeType: 'application/vnd.google-apps.folder', parents: [FOLDER] },
  [INSIDE]: { name: 'notes.md', mimeType: 'text/markdown', parents: [SUB], size: 20, content: 'inside notes' },
  [OUTSIDE]: { name: 'secret.txt', mimeType: 'text/plain', parents: ['otherFolder0000'], size: 5, content: 'TOP SECRET' },
  // 'otherFolder0000' and 'rootRootRoot0' are deliberately absent: Drive answers 404 for ancestors
  // the token cannot read, which the ancestor walk must treat as a dead end.
  docDocDocDocDoc: { name: 'Plan', mimeType: 'application/vnd.google-apps.document', parents: [FOLDER], content: 'plan text' },
  sheetSheetSheet1: { name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [FOLDER], content: 'a,b\n1,2' },
  imageImageImage1: { name: 'pic.png', mimeType: 'image/png', parents: [FOLDER], size: 10 },
  bigFileBigFile01: { name: 'big.txt', mimeType: 'text/plain', parents: [FOLDER], size: 5_000_000 },
  binaryBinary0001: { name: 'x.txt', mimeType: 'text/plain', parents: [FOLDER], size: 5, content: 'a\u0000b' },
};

function res(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) };
}

function makeFetch() {
  const urls: string[] = [];
  const f: GoogleFetch = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const fileMatch = /\/drive\/v3\/files\/([^/?]+)(\/export)?$/.exec(u.pathname);
    if (fileMatch) {
      const f = tree[fileMatch[1]];
      if (!f) return res('nope', 404);
      if (fileMatch[2] || u.searchParams.get('alt') === 'media') return res(f.content ?? '');
      return res({ id: fileMatch[1], name: f.name, mimeType: f.mimeType, parents: f.parents, size: f.size?.toString() });
    }
    if (u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const files = Object.entries(tree)
        .filter(([, v]) => v.parents.includes(parent ?? ''))
        .map(([id, v]) => ({ id, name: v.name, mimeType: v.mimeType, size: v.size?.toString() }));
      return res({ files });
    }
    return res('unexpected', 500);
  };
  return { f, urls };
}

const client = () => {
  const { f, urls } = makeFetch();
  return { g: createGoogleClient(async () => 'tok', f), urls };
};

describe('drive client', () => {
  it('lists a folder using the folder id in the query', async () => {
    const { g, urls } = client();
    const entries = await g.listFolder(FOLDER);
    expect(entries.map((e) => e.name).sort()).toEqual(['Budget', 'Plan', 'Sub', 'big.txt', 'pic.png', 'x.txt']);
    expect(new URL(urls[0]).searchParams.get('q')).toBe(`'${FOLDER}' in parents and trashed = false`);
  });

  it('rejects ids that could break out of the query', async () => {
    const { g } = client();
    await expect(g.listFolder("x' or 'a'='a")).rejects.toThrow(/Invalid Drive id/);
    await expect(g.getEntry('../etc')).rejects.toBeInstanceOf(GoogleError);
  });

  it('reads Docs as text, Sheets as CSV, and plain files as media', async () => {
    const { g, urls } = client();
    expect(await g.readFileText({ id: 'docDocDocDocDoc', name: 'Plan', mimeType: 'application/vnd.google-apps.document' })).toBe('plan text');
    expect(urls[0]).toContain('/export?mimeType=text%2Fplain');
    expect(await g.readFileText({ id: 'sheetSheetSheet1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' })).toBe('a,b\n1,2');
    expect(urls[1]).toContain('text%2Fcsv');
    expect(await g.readFileText({ id: INSIDE, name: 'notes.md', mimeType: 'text/markdown', size: 20 })).toBe('inside notes');
    expect(urls[2]).toContain('alt=media');
  });

  it('refuses images, oversized files and binary content', async () => {
    const { g } = client();
    await expect(g.readFileText({ id: 'imageImageImage1', name: 'pic.png', mimeType: 'image/png' })).rejects.toThrow(/not a text-readable/);
    await expect(g.readFileText({ id: 'bigFileBigFile01', name: 'big.txt', mimeType: 'text/plain', size: 5_000_000 })).rejects.toThrow(/too large/);
    await expect(g.readFileText({ id: 'binaryBinary0001', name: 'x.txt', mimeType: 'text/plain', size: 5 })).rejects.toThrow(/binary/);
  });

  it('classifies readable types', () => {
    expect(isReadableDriveFile({ name: 'a.ts', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isReadableDriveFile({ name: 'a.png', mimeType: 'image/png' })).toBe(false);
    expect(isReadableDriveFile({ name: 'Doc', mimeType: 'application/vnd.google-apps.document' })).toBe(true);
  });

  it('treats unreadable ancestors as dead ends and still follows other parents', async () => {
    const { g } = client();
    // OUTSIDE's only parent is unreadable (404): not inside, and no error.
    expect(await g.isInsideFolder(OUTSIDE, FOLDER)).toBe(false);
    // A file with one unreadable parent and one that leads to the folder is still found.
    tree.multiParentFile1 = { name: 'm.txt', mimeType: 'text/plain', parents: ['unreadableParent0', FOLDER], size: 1, content: 'm' };
    expect(await g.isInsideFolder('multiParentFile1', FOLDER)).toBe(true);
    delete tree.multiParentFile1;
  });

  it('knows whether a file is nested inside a folder', async () => {
    const { g } = client();
    expect(await g.isInsideFolder(INSIDE, FOLDER)).toBe(true); // file -> Sub -> Specs
    expect(await g.isInsideFolder(OUTSIDE, FOLDER)).toBe(false);
    expect(await g.isInsideFolder(INSIDE, FOLDER, 1)).toBe(false); // depth limit reached before the folder
  });
});

describe('drive folder tools are scoped to the attached folder', () => {
  const tools = () => {
    const { g } = client();
    const [list, read] = driveFolderTools(g, { folderId: FOLDER, name: 'Specs' });
    return { list, read };
  };

  it('lists the attached folder and marks unreadable files', async () => {
    const out = await tools().list.execute({}, {});
    expect(out).toContain('[folder] Sub');
    expect(out).toContain('pic.png');
    expect(out).toContain('not readable as text');
  });

  it('refuses to list or read anything outside the folder', async () => {
    const { list, read } = tools();
    await expect(list.execute({ folder_id: 'otherFolder0000' }, {})).rejects.toThrow(/outside the attached folder/);
    await expect(read.execute({ file_id: OUTSIDE }, {})).rejects.toThrow(/outside the attached folder/);
  });

  it('reads nested files inside the folder', async () => {
    expect(await tools().read.execute({ file_id: INSIDE }, {})).toBe('inside notes');
    await expect(tools().read.execute({}, {})).rejects.toThrow(/Missing required/);
  });
});

describe('system prompt mentions attached Drive folders', () => {
  it('names the folder and the tools', () => {
    const project: Project = {
      id: 'p',
      name: 'Grid',
      instructions: '',
      createdAt: 0,
      resources: [{ id: '1', kind: 'drive-folder', folderId: FOLDER, name: 'Specs' }],
    };
    const prompt = buildSystemPrompt('Base.', project);
    expect(prompt).toContain('Google Drive folder "Specs"');
    expect(prompt).toContain('drive_folder_read');
  });
});
