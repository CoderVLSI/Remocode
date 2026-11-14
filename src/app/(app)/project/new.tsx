import { router } from 'expo-router';
import { useState } from 'react';

import type { NewResource } from '@/lib/projects';
import { useChat } from '@/store/chat';
import { colors } from '@/theme';
import { AddResourceSheet, resourceIcon, resourceSubtitle, resourceTitle } from '@/ui/AddResource';
import { Button, Card, Icon, Input, Row, Screen, SectionTitle, T } from '@/ui/components';

export default function NewProject() {
  const createProject = useChat((s) => s.createProject);
  const addResource = useChat((s) => s.addResource);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [resources, setResources] = useState<NewResource[]>([]);
  const [adding, setAdding] = useState(false);

  const create = () => {
    const project = createProject(name, instructions);
    for (const r of resources) addResource(project.id, r);
    // Replace the modal so Back from the project returns to Home, not to this form.
    router.replace({ pathname: '/project/[id]', params: { id: project.id } });
  };

  return (
    <Screen>
      <Input label="Name" value={name} onChangeText={setName} placeholder="My app" autoCapitalize="words" autoFocus />
      <Input
        label="Instructions (optional)"
        value={instructions}
        onChangeText={setInstructions}
        placeholder="Tell the model how to work in this project"
        multiline
        autoCapitalize="sentences"
        style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: 12 }}
      />

      <SectionTitle>Resources</SectionTitle>
      {resources.length > 0 ? (
        <Card>
          {resources.map((r, i) => (
            <Row
              key={`${i}-${resourceTitle(r)}`}
              icon={resourceIcon(r)}
              title={resourceTitle(r)}
              subtitle={resourceSubtitle(r)}
              right={<Icon name="close" size={18} color={colors.muted} />}
              onPress={() => setResources(resources.filter((_, j) => j !== i))}
            />
          ))}
        </Card>
      ) : (
        <T variant="small">Optional. Connect your files, Drive, or a GitHub repo so the model has context from the start.</T>
      )}
      <Button title="Add resource" kind="secondary" icon="add" onPress={() => setAdding(true)} />

      <Button title="Create project" onPress={create} disabled={!name.trim()} />

      <AddResourceSheet
        visible={adding}
        onClose={() => setAdding(false)}
        existing={resources}
        onAdd={(r) => setResources((list) => [...list, r])}
      />
    </Screen>
  );
}
