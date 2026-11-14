import type { ToolExecutor } from '../llm/agent';

import type { GitHubClient } from './github';
import { isFolder, isReadableDriveFile } from './google';
import type { GoogleClient } from './google';

function str(args: Record<string, unknown>, key: string, required = true): string {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (required) throw new Error(`Missing required string argument "${key}".`);
  return '';
}

/** Tools locked to a single attached repository so the model cannot wander to others. */
export function githubTools(client: GitHubClient, repo: string, ref?: string): ToolExecutor[] {
  return [
    {
      spec: {
        name: 'github_list_dir',
        description: `List files and folders in the attached repository (${repo}). Use an empty path for the repository root.`,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Directory path relative to the repo root' } },
        },
      },
      async execute(args, { signal }) {
        const entries = await client.listDir(repo, str(args, 'path', false), ref, signal);
        return entries.length
          ? entries.map((e) => `${e.type === 'dir' ? '[dir] ' : ''}${e.path}${e.type === 'file' ? ` (${e.size} B)` : ''}`).join('\n')
          : '(empty directory)';
      },
    },
    {
      spec: {
        name: 'github_read_file',
        description: `Read a text file from the attached repository (${repo}).`,
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path relative to the repo root' } },
          required: ['path'],
        },
      },
      execute: async (args, { signal }) => client.readFile(repo, str(args, 'path'), ref, signal),
    },
    {
      spec: {
        name: 'github_search_code',
        description: `Search code in the attached repository (${repo}). Returns matching file paths.`,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search terms' } },
          required: ['query'],
        },
      },
      async execute(args, { signal }) {
        const hits = await client.searchCode(repo, str(args, 'query'), signal);
        return hits.length ? hits.map((h) => h.path).join('\n') : 'No matches.';
      },
    },
  ];
}

/** Read-only Google Workspace tools. */
export function googleTools(client: GoogleClient): ToolExecutor[] {
  return [
    {
      spec: {
        name: 'calendar_upcoming_events',
        description: "List events on the user's primary Google Calendar for the next N days.",
        parameters: {
          type: 'object',
          properties: { days: { type: 'number', description: 'Days ahead to look (1-31, default 7)' } },
        },
      },
      execute: async (args, { signal }) => client.upcomingEvents(Number(args.days) || 7, new Date(), signal),
    },
    {
      spec: {
        name: 'drive_search',
        description: "Search the user's Google Drive by text. Returns file names and ids.",
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Text to search for' } },
          required: ['query'],
        },
      },
      execute: async (args, { signal }) => client.driveSearch(str(args, 'query'), signal),
    },
    {
      spec: {
        name: 'docs_read',
        description: 'Read the text of a Google Doc by its file id (from drive_search).',
        parameters: {
          type: 'object',
          properties: { file_id: { type: 'string', description: 'Google Doc file id' } },
          required: ['file_id'],
        },
      },
      execute: async (args, { signal }) => client.readDoc(str(args, 'file_id'), signal),
    },
    {
      spec: {
        name: 'sheets_read',
        description: 'Read cell values from a Google Sheet by id and A1 range (default A1:Z100).',
        parameters: {
          type: 'object',
          properties: {
            spreadsheet_id: { type: 'string', description: 'Spreadsheet id' },
            range: { type: 'string', description: 'A1 range such as Sheet1!A1:D20' },
          },
          required: ['spreadsheet_id'],
        },
      },
      execute: async (args, { signal }) => client.readSheet(str(args, 'spreadsheet_id'), str(args, 'range', false), signal),
    },
  ];
}

/**
 * Tools locked to one attached Drive folder. Reads are verified to be inside the
 * folder, so the model cannot be steered into reading the rest of the user's Drive.
 */
export function driveFolderTools(client: GoogleClient, folder: { folderId: string; name: string }): ToolExecutor[] {
  return [
    {
      spec: {
        name: 'drive_folder_list',
        description: `List files and subfolders in the attached Google Drive folder "${folder.name}" (or one of its subfolders).`,
        parameters: {
          type: 'object',
          properties: {
            folder_id: { type: 'string', description: 'Subfolder id from a previous listing. Omit for the attached folder itself.' },
          },
        },
      },
      async execute(args, { signal }) {
        const id = str(args, 'folder_id', false) || folder.folderId;
        if (id !== folder.folderId && !(await client.isInsideFolder(id, folder.folderId, 8, signal))) {
          throw new Error('That folder is outside the attached folder.');
        }
        const entries = await client.listFolder(id, signal);
        return entries.length
          ? entries
              .map((e) => `${isFolder(e) ? '[folder] ' : ''}${e.name} (id: ${e.id}${isFolder(e) || isReadableDriveFile(e) ? '' : ', not readable as text'})`)
              .join('\n')
          : '(empty folder)';
      },
    },
    {
      spec: {
        name: 'drive_folder_read',
        description: `Read a text-like file (Google Doc, Sheet as CSV, Slides, or a text/code file) from inside the attached Drive folder "${folder.name}".`,
        parameters: {
          type: 'object',
          properties: { file_id: { type: 'string', description: 'File id from drive_folder_list' } },
          required: ['file_id'],
        },
      },
      async execute(args, { signal }) {
        const id = str(args, 'file_id');
        if (!(await client.isInsideFolder(id, folder.folderId, 8, signal))) {
          throw new Error('That file is outside the attached folder.');
        }
        const entry = await client.getEntry(id, signal);
        return client.readFileText(entry, signal);
      },
    },
  ];
}
