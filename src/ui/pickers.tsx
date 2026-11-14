import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { GitHubEntry, GitHubRepo } from '@/lib/connectors/github';
import { isFolder, isReadableDriveFile } from '@/lib/connectors/google';
import type { DriveEntry } from '@/lib/connectors/google';
import { getGitHubClient, getGoogleClient } from '@/lib/connectors/runtime';
import { colors, space } from '@/theme';

import { Button, Input, Row, Sheet, T } from './components';

const MAX_PINNED_FILE_CHARS = 60_000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function RepoPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (repo: GitHubRepo) => void }) {
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const client = await getGitHubClient();
      if (!client) throw new Error('Connect GitHub in Customizations first.');
      setRepos(await client.listRepos(1));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (!visible || repos !== null) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [visible, repos, load]);

  const shown = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a repository">
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Input placeholder="Filter" value={filter} onChangeText={setFilter} />
      </View>
      {error ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <T variant="small" style={{ color: colors.danger }}>{error}</T>
          <Button title="Try again" kind="secondary" onPress={() => { setRepos(null); setError(null); }} />
        </View>
      ) : repos === null ? (
        <View style={{ padding: space.xl }}><ActivityIndicator color={colors.muted} /></View>
      ) : (
        shown.map((r) => (
          <Row
            key={r.fullName}
            icon={r.private ? 'lock-closed-outline' : 'logo-github'}
            title={r.fullName}
            subtitle={r.description ?? undefined}
            onPress={() => onPick(r)}
          />
        ))
      )}
    </Sheet>
  );
}

/** Browse a GitHub repo and pin individual files as context. */
export function GitHubFilePicker({
  repo,
  refName,
  visible,
  onClose,
  onPick,
}: {
  repo: string;
  refName?: string;
  visible: boolean;
  onClose: () => void;
  onPick: (path: string, content: string) => void;
}) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<GitHubEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(
    async (p: string) => {
      setBusy(true);
      setError(null);
      try {
        const client = await getGitHubClient();
        if (!client) throw new Error('Connect GitHub in Customizations first.');
        setEntries(await client.listDir(repo, p, refName));
        setPath(p);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [repo, refName],
  );

  useEffect(() => {
    if (!visible || entries !== null) return;
    const t = setTimeout(() => void open(''), 0);
    return () => clearTimeout(t);
  }, [visible, entries, open]);

  const pickFile = async (e: GitHubEntry) => {
    setBusy(true);
    try {
      const client = await getGitHubClient();
      if (!client) throw new Error('Connect GitHub in Customizations first.');
      const text = await client.readFile(repo, e.path, refName);
      onPick(e.path, text.slice(0, MAX_PINNED_FILE_CHARS));
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (
    <Sheet visible={visible} onClose={onClose} title={`${repo}/${path}`}>
      {error ? <T variant="small" style={{ color: colors.danger, padding: space.lg }}>{error}</T> : null}
      {busy ? <View style={{ padding: space.lg }}><ActivityIndicator color={colors.muted} /></View> : null}
      {path ? <Row icon="arrow-up" title=".." onPress={() => void open(parent)} /> : null}
      {(entries ?? []).map((e) => (
        <Row
          key={e.path}
          icon={e.type === 'dir' ? 'folder-outline' : 'document-text-outline'}
          title={e.name}
          subtitle={e.type === 'file' ? `${Math.max(1, Math.round(e.size / 1024))} KB` : undefined}
          onPress={e.type === 'dir' ? () => void open(e.path) : e.type === 'file' ? () => void pickFile(e) : undefined}
        />
      ))}
    </Sheet>
  );
}

interface Crumb {
  id: string;
  name: string;
}

/**
 * Browse Google Drive. Folders can be attached (the model may browse them, read-only);
 * readable files can be pinned as a text snapshot.
 */
export function DrivePicker({
  visible,
  onClose,
  onAttachFolder,
  onPinFile,
  pinnedIds,
}: {
  visible: boolean;
  onClose: () => void;
  onAttachFolder: (folder: { folderId: string; name: string }) => void;
  onPinFile: (file: { id: string; name: string; content: string }) => void;
  pinnedIds: ReadonlySet<string>;
}) {
  const [stack, setStack] = useState<Crumb[]>([{ id: 'root', name: 'My Drive' }]);
  const [result, setResult] = useState<{ id: string; entries?: DriveEntry[]; error?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  // A result only counts for the folder it was fetched for, so navigating shows the spinner
  // without resetting state inside the effect.
  const fresh = result && result.id === current.id ? result : null;
  const entries = fresh?.entries ?? null;
  const error = actionError ?? fresh?.error ?? null;

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    getGoogleClient()
      .listFolder(current.id)
      .then((list) => alive && setResult({ id: current.id, entries: list }))
      .catch((err) => alive && setResult({ id: current.id, error: errorText(err) }));
    return () => {
      alive = false;
    };
  }, [visible, current.id]);

  const pin = async (entry: DriveEntry) => {
    setBusyId(entry.id);
    setActionError(null);
    try {
      const content = await getGoogleClient().readFileText(entry);
      onPinFile({ id: entry.id, name: entry.name, content: content.slice(0, MAX_PINNED_FILE_CHARS) });
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={stack.map((c) => c.name).join(' / ')}>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        {current.id !== 'root' ? (
          <Button
            title={`Attach “${current.name}” as a folder`}
            icon="folder-open-outline"
            onPress={() => {
              onAttachFolder({ folderId: current.id, name: current.name });
              onClose();
            }}
          />
        ) : (
          <T variant="small">Open a folder, then attach it so the model can browse it. Or tap a file to pin its text.</T>
        )}
        {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}
      </View>
      {stack.length > 1 ? <Row icon="arrow-up" title=".." onPress={() => { setActionError(null); setStack(stack.slice(0, -1)); }} /> : null}
      {entries === null && !error ? <View style={{ padding: space.xl }}><ActivityIndicator color={colors.muted} /></View> : null}
      {(entries ?? []).map((e) => {
        const folder = isFolder(e);
        const readable = folder || isReadableDriveFile(e);
        const pinned = pinnedIds.has(e.id);
        return (
          <Row
            key={e.id}
            icon={folder ? 'folder-outline' : pinned ? 'checkmark-circle' : 'document-text-outline'}
            title={e.name}
            subtitle={folder ? undefined : readable ? (pinned ? 'Pinned' : 'Tap to pin') : 'Not readable as text'}
            right={busyId === e.id ? <ActivityIndicator color={colors.muted} /> : folder ? undefined : <View />}
            onPress={
              folder
                ? () => { setActionError(null); setStack([...stack, { id: e.id, name: e.name }]); }
                : readable && !pinned && busyId === null
                  ? () => void pin(e)
                  : undefined
            }
          />
        );
      })}
      {entries && entries.length === 0 ? <T variant="small" style={{ padding: space.lg }}>This folder is empty.</T> : null}
      <View style={{ height: space.md }} />
    </Sheet>
  );
}
