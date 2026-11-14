import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';

import { getGitHubClient } from '@/lib/connectors/runtime';
import type { GitHubEntry, GitHubRepo } from '@/lib/connectors/github';
import { useChat } from '@/store/chat';
import { useConnectors } from '@/store/connectors';
import { colors, space } from '@/theme';
import { Button, Card, Empty, Icon, Input, Row, Screen, SectionTitle, Sheet, T } from '@/ui/components';

const MAX_PINNED_FILE_CHARS = 60_000;

function RepoPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (repo: GitHubRepo) => void }) {
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Load lazily the first time the sheet opens.
  if (visible && repos === null && !error) void load();

  const shown = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a repository">
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <Input placeholder="Filter" value={filter} onChangeText={setFilter} />
      </View>
      {error ? (
        <View style={{ padding: space.lg, gap: space.md }}>
          <T variant="small" style={{ color: colors.danger }}>{error}</T>
          <Button title="Try again" kind="secondary" onPress={() => { setRepos(null); void load(); }} />
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

function FilePicker({
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
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [repo, refName],
  );

  if (visible && entries === null && !error && !busy) void open('');

  const pickFile = async (e: GitHubEntry) => {
    setBusy(true);
    try {
      const client = await getGitHubClient();
      if (!client) throw new Error('Connect GitHub in Customizations first.');
      const text = await client.readFile(repo, e.path, refName);
      onPick(e.path, text.slice(0, MAX_PINNED_FILE_CHARS));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useChat((s) => s.projects.find((p) => p.id === id));
  const conversations = useChat((s) => s.conversations.filter((c) => c.projectId === id));
  const { updateProject, deleteProject, addResource, removeResource, createConversation } = useChat.getState();
  const githubConnected = useConnectors((s) => s.github.connected);

  const [repoOpen, setRepoOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Empty icon="alert-circle-outline" title="Project not found" />
      </View>
    );
  }

  const repo = project.resources.find((r) => r.kind === 'github');

  return (
    <Screen>
      <Stack.Screen options={{ title: project.name }} />
      <Input label="Name" value={project.name} onChangeText={(name) => updateProject(project.id, { name })} autoCapitalize="words" />
      <Input
        label="Instructions"
        value={project.instructions}
        onChangeText={(instructions) => updateProject(project.id, { instructions })}
        multiline
        autoCapitalize="sentences"
        style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }}
      />

      <SectionTitle>Resources</SectionTitle>
      <Card>
        {project.resources.length === 0 ? (
          <T variant="small" style={{ padding: space.lg }}>Nothing attached yet. Attach a GitHub repo so the model can browse it, or pin files as context.</T>
        ) : (
          project.resources.map((r) => (
            <Row
              key={r.id}
              icon={r.kind === 'github' ? 'logo-github' : 'document-text-outline'}
              title={r.kind === 'github' ? r.repo : r.name}
              subtitle={r.kind === 'github' ? `Browsable by the model${r.ref ? ` · ${r.ref}` : ''}` : `Pinned · ${r.content.length.toLocaleString()} characters`}
              right={<Icon name="close" size={18} color={colors.muted} />}
              onPress={() => removeResource(project.id, r.id)}
            />
          ))
        )}
      </Card>
      {githubConnected ? (
        <View style={{ gap: space.sm }}>
          {!repo ? <Button title="Attach GitHub repo" kind="secondary" icon="logo-github" onPress={() => setRepoOpen(true)} /> : null}
          {repo && repo.kind === 'github' ? (
            <Button title="Pin a file from the repo" kind="secondary" icon="pin-outline" onPress={() => setFileOpen(true)} />
          ) : null}
        </View>
      ) : (
        <Button title="Connect GitHub to attach repos" kind="secondary" icon="logo-github" onPress={() => router.push('/customizations')} />
      )}

      <SectionTitle>Conversations</SectionTitle>
      <Button
        title="New conversation"
        icon="add"
        onPress={() => {
          const c = createConversation(project.id);
          router.push({ pathname: '/chat/[id]', params: { id: c.id } });
        }}
      />
      <Card>
        {conversations.map((c) => (
          <Row key={c.id} title={c.title} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })} />
        ))}
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <Button
        title="Delete project"
        kind="danger"
        onPress={() =>
          Alert.alert('Delete project?', 'Its conversations are kept as regular chats.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                deleteProject(project.id);
                router.back();
              },
            },
          ])
        }
      />

      <RepoPicker
        visible={repoOpen}
        onClose={() => setRepoOpen(false)}
        onPick={(r) => {
          addResource(project.id, { kind: 'github', repo: r.fullName, ref: r.defaultBranch });
          setRepoOpen(false);
        }}
      />
      {repo && repo.kind === 'github' ? (
        <FilePicker
          repo={repo.repo}
          refName={repo.ref}
          visible={fileOpen}
          onClose={() => setFileOpen(false)}
          onPick={(path, content) => addResource(project.id, { kind: 'file', name: path, content, source: `github:${repo.repo}` })}
        />
      ) : null}
    </Screen>
  );
}
