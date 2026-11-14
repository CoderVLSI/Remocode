import { router } from 'expo-router';
import { useState } from 'react';

import { useChat } from '@/store/chat';
import { Button, Input, Screen } from '@/ui/components';

export default function NewProject() {
  const createProject = useChat((s) => s.createProject);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');

  const create = () => {
    const project = createProject(name, instructions);
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
      <Button title="Create project" onPress={create} disabled={!name.trim()} />
    </Screen>
  );
}
