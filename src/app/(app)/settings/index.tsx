import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { useAuth } from '@/store/auth';
import { DEFAULT_SYSTEM_PROMPT, useSettings } from '@/store/settings';
import { colors, space } from '@/theme';
import { Button, Card, Input, Row, Screen, SectionTitle, T } from '@/ui/components';
import { useModels } from '@/ui/ModelPicker';

export default function SettingsScreen() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const { selected } = useModels();
  const systemPrompt = useSettings((s) => s.systemPrompt);
  const setSystemPrompt = useSettings((s) => s.setSystemPrompt);
  const voice = useSettings((s) => s.voice);
  const updateVoice = useSettings((s) => s.updateVoice);
  const [prompt, setPrompt] = useState(systemPrompt);

  return (
    <Screen>
      <SectionTitle>Account</SectionTitle>
      <Card>
        <Row title={user?.email ?? 'Signed in'} subtitle="Synced devices and projects use this account" icon="person-circle-outline" />
      </Card>

      <SectionTitle>Models</SectionTitle>
      <Card>
        <Row
          icon="hardware-chip-outline"
          title="Models & API keys"
          subtitle={selected ? `Current: ${selected.label}` : 'No model yet'}
          onPress={() => router.push('/settings/models')}
        />
        <Row icon="grid-outline" title="Customizations" subtitle="GitHub, Google and other connectors" onPress={() => router.push('/customizations')} />
      </Card>

      <SectionTitle>Voice</SectionTitle>
      <Card>
        <Row
          title="Read replies aloud"
          right={<Switch value={voice.speak} onValueChange={(v) => updateVoice({ speak: v })} trackColor={{ true: colors.primary }} />}
        />
        <Row
          title="On-device recognition"
          subtitle="Keeps your audio on the phone when your device supports it"
          right={<Switch value={voice.onDeviceRecognition} onValueChange={(v) => updateVoice({ onDeviceRecognition: v })} trackColor={{ true: colors.primary }} />}
        />
      </Card>
      <Input
        label="Voice language (BCP-47)"
        value={voice.language}
        onChangeText={(v) => updateVoice({ language: v })}
        placeholder="en-US"
        autoCapitalize="none"
      />

      <SectionTitle>Behaviour</SectionTitle>
      <Input
        label="System prompt"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: space.md }}
        autoCapitalize="sentences"
        autoCorrect
      />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Save" kind="secondary" onPress={() => setSystemPrompt(prompt)} disabled={prompt === systemPrompt} style={{ flex: 1 }} />
        <Button
          title="Reset"
          kind="ghost"
          onPress={() => {
            setPrompt(DEFAULT_SYSTEM_PROMPT);
            setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          }}
          style={{ flex: 1 }}
        />
      </View>

      <SectionTitle>Session</SectionTitle>
      <Button
        title="Sign out"
        kind="danger"
        onPress={() =>
          Alert.alert('Sign out?', 'Chats and API keys stay on this device.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
          ])
        }
      />
      <T variant="small" style={{ textAlign: 'center' }}>Remocode 0.1.0</T>
    </Screen>
  );
}
