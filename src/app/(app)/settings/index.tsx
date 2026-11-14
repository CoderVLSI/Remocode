import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { useAuth } from '@/store/auth';
import { DEFAULT_SYSTEM_PROMPT, useSettings } from '@/store/settings';
import { colors, space } from '@/theme';
import { LIVE_VOICES } from '@/lib/live/protocol';
import { pickLiveModel } from '@/lib/llm/modelOptions';
import { Button, Card, Icon, Input, Row, Screen, SectionTitle, Sheet, T } from '@/ui/components';
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
  const liveModels = useSettings((s) => s.liveModels);
  const hasGeminiKey = useSettings((s) => !!s.hasKey.gemini);
  const [modelSheet, setModelSheet] = useState(false);
  const [voiceSheet, setVoiceSheet] = useState(false);
  const effectiveLive = pickLiveModel(liveModels, voice.liveModel);

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
          icon="sparkles-outline"
          title="Voice engine"
          subtitle={
            voice.engine === 'live'
              ? hasGeminiKey
                ? 'Gemini Live: two-way talk, interrupt any time, tools'
                : 'Gemini Live needs a Gemini key; classic voice is used until you add one'
              : 'Classic: speech-to-text, then spoken replies'
          }
          right={<T variant="small">{voice.engine === 'live' ? 'Live' : 'Classic'}</T>}
          onPress={() => updateVoice({ engine: voice.engine === 'live' ? 'classic' : 'live' })}
        />
        <Row
          icon="hardware-chip-outline"
          title="Live model"
          subtitle={effectiveLive ? `${voice.liveModel ? '' : 'Auto: '}${effectiveLive}` : 'None found. Refresh models under Models → Gemini.'}
          onPress={() => setModelSheet(true)}
        />
        <Row icon="person-outline" title="Live voice" subtitle={voice.liveVoice} onPress={() => setVoiceSheet(true)} />
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

      <Sheet visible={modelSheet} onClose={() => setModelSheet(false)} title="Gemini Live model">
        <Row
          title="Auto (newest available)"
          right={voice.liveModel === null ? <Icon name="checkmark" /> : <View />}
          onPress={() => {
            updateVoice({ liveModel: null });
            setModelSheet(false);
          }}
        />
        {liveModels.map((m) => (
          <Row
            key={m.id}
            title={m.label}
            subtitle={m.id}
            right={voice.liveModel === m.id ? <Icon name="checkmark" /> : <View />}
            onPress={() => {
              updateVoice({ liveModel: m.id });
              setModelSheet(false);
            }}
          />
        ))}
        {liveModels.length === 0 ? (
          <T variant="small" style={{ padding: space.lg }}>
            No Live models yet. Add a Gemini key and refresh in Settings → Models → Gemini.
          </T>
        ) : null}
      </Sheet>
      <Sheet visible={voiceSheet} onClose={() => setVoiceSheet(false)} title="Gemini Live voice">
        {LIVE_VOICES.map((v) => (
          <Row
            key={v}
            title={v}
            right={voice.liveVoice === v ? <Icon name="checkmark" /> : <View />}
            onPress={() => {
              updateVoice({ liveVoice: v });
              setVoiceSheet(false);
            }}
          />
        ))}
      </Sheet>

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
      <T variant="small" style={{ textAlign: 'center' }}>Remo Code 0.1.0</T>
    </Screen>
  );
}
