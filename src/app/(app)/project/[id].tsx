import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { useChat } from '@/store/chat';
import { colors, space } from '@/theme';
import { AddResourceSheet, resourceIcon, resourceSubtitle, resourceTitle } from '@/ui/AddResource';
import { Button, Card, Empty, Icon, Input, Row, Screen, SectionTitle, T } from '@/ui/components';
import { GitHubFilePicker } from '@/ui/pickers';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useChat((s) => s.projects.find((p) => p.id === id));
  const conversations = useChat((s) => s.conversations.filter((c) => c.projectId === id));
  const { updateProject, deleteProject, addResource, removeResource, createConversation } = useChat.getState();

  const [adding, setAdding] = useState(false);
  const [pinningFile, setPinningFile] = useState(false);

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
          <T variant="small" style={{ padding: space.lg }}>
            Nothing attached yet. Add a Drive folder, upload files, or attach a GitHub repo so the model has context.
          </T>
        ) : (
          project.resources.map((r) => (
            <Row
              key={r.id}
              icon={resourceIcon(r)}
              title={resourceTitle(r)}
              subtitle={resourceSubtitle(r)}
              right={<Icon name="close" size={18} color={colors.muted} />}
              onPress={() => removeResource(project.id, r.id)}
            />
          ))
        )}
      </Card>
      <Button title="Add resource" icon="add" kind="secondary" onPress={() => setAdding(true)} />
      {repo && repo.kind === 'github' ? (
        <Button title="Pin a file from the repo" kind="secondary" icon="pin-outline" onPress={() => setPinningFile(true)} />
      ) : null}

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

      <AddResourceSheet
        visible={adding}
        onClose={() => setAdding(false)}
        existing={project.resources}
        onAdd={(r) => addResource(project.id, r)}
      />
      {repo && repo.kind === 'github' ? (
        <GitHubFilePicker
          repo={repo.repo}
          refName={repo.ref}
          visible={pinningFile}
          onClose={() => setPinningFile(false)}
          onPick={(path, content) => addResource(project.id, { kind: 'file', name: path, content, source: `github:${repo.repo}` })}
        />
      ) : null}
    </Screen>
  );
}
