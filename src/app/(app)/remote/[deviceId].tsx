import { useMutation, useQuery } from 'convex/react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { isFinal, statusLabel, toSegments } from '@/lib/remote/model';
import type { RemoteEvent, RemoteTask } from '@/lib/remote/model';
import { colors, font, radius, space } from '@/theme';
import { Banner, Button, Icon, Row, SectionTitle, T } from '@/ui/components';

/** The only ScrollView method we call; avoids depending on RN's internal instance type. */
interface ScrollHandle {
  scrollToEnd(options?: { animated?: boolean }): void;
}

function statusColor(s: RemoteTask['status']): string {
  return s === 'done' ? colors.success : s === 'failed' ? colors.danger : s === 'running' ? colors.primary : colors.muted;
}

const cleanError = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?/i, '').replace(/^Uncaught (Convex)?Error:\s*/i, '');

/**
 * Live output for one task. Both queries are reactive: Convex pushes each new chunk the moment the
 * computer writes it, so there is no polling or merging here.
 */
function TaskOutput({ taskId, onError }: { taskId: Id<'tasks'>; onError: (m: string) => void }) {
  const task = useQuery(api.tasks.get, { taskId }) as RemoteTask | null | undefined;
  const events = useQuery(api.tasks.events, { taskId }) as RemoteEvent[] | undefined;
  const cancel = useMutation(api.tasks.cancel);
  const scroll = useRef<ScrollHandle | null>(null);
  const segments = useMemo(() => toSegments(events ?? []), [events]);
  const active = task && !isFinal(task.status);

  return (
    <View style={{ gap: space.sm }}>
      {task ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(task.status) }} />
          <T style={{ fontWeight: '600', flex: 1 }}>
            {statusLabel(task.status)}
            {task.exitCode !== null && task.status !== 'cancelled' ? ` (exit ${task.exitCode})` : ''}
          </T>
          {active ? (
            <Pressable onPress={() => cancel({ taskId }).catch((e) => onError(cleanError(e)))} accessibilityRole="button" hitSlop={8}>
              <T style={{ color: colors.danger, fontWeight: '600' }}>Cancel</T>
            </Pressable>
          ) : null}
        </View>
      ) : task === undefined ? (
        <ActivityIndicator color={colors.muted} />
      ) : (
        <T variant="small">This task no longer exists.</T>
      )}
      {task?.status === 'queued' ? <T variant="small">Queued. The task starts as soon as the companion on that computer picks it up.</T> : null}
      <ScrollView
        ref={(r) => {
          scroll.current = r as unknown as ScrollHandle | null;
        }}
        nestedScrollEnabled
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        style={{ maxHeight: 340, backgroundColor: '#03051A', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
        contentContainerStyle={{ padding: space.md }}
      >
        {segments.length === 0 ? (
          <T variant="small">No output yet.</T>
        ) : (
          <Text selectable style={font.mono}>
            {segments.map((s, i) => (
              <Text key={i} style={{ color: s.kind === 'stderr' ? colors.warning : s.kind === 'info' ? colors.muted : colors.text }}>
                {s.text}
              </Text>
            ))}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

export default function DeviceScreen() {
  const { deviceId, name } = useLocalSearchParams<{ deviceId: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const tasks = useQuery(api.tasks.list, { deviceId: deviceId as Id<'devices'> }) as RemoteTask[] | undefined;
  const createTask = useMutation(api.tasks.create);

  const [selected, setSelected] = useState<Id<'tasks'> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createTask({ deviceId: deviceId as Id<'devices'>, prompt });
      setPrompt('');
      setSelected(id);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: name ?? 'Device' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="error" title="Something went wrong" message={error} onClose={() => setError(null)} /> : null}

        <SectionTitle>Output</SectionTitle>
        {selected ? <TaskOutput key={selected} taskId={selected} onError={setError} /> : <T variant="small">Run a task below, or pick one from history.</T>}

        <SectionTitle>History</SectionTitle>
        {tasks === undefined ? (
          <ActivityIndicator color={colors.muted} />
        ) : tasks.length === 0 ? (
          <T variant="small">No tasks yet.</T>
        ) : (
          tasks.map((t) => (
            <Row
              key={t._id}
              title={t.prompt.replace(/\s+/g, ' ')}
              subtitle={`${statusLabel(t.status)} · ${new Date(t.createdAt).toLocaleString()}`}
              right={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(t.status) }} />}
              onPress={() => setSelected(t._id)}
            />
          ))
        )}
      </ScrollView>

      <View style={{ padding: space.md, paddingBottom: Math.max(insets.bottom, space.md), gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="What should the agent do on this computer?"
          placeholderTextColor={colors.muted}
          multiline
          accessibilityLabel="Task"
          style={{ color: colors.text, fontSize: 16, maxHeight: 120, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md }}
        />
        <Button title="Run on this computer" icon="play" onPress={submit} loading={busy} disabled={!prompt.trim()} />
        <T variant="small" style={{ textAlign: 'center' }}>
          <Icon name="shield-checkmark-outline" size={12} color={colors.muted} /> Runs the agent configured on that computer, in its working folder.
        </T>
      </View>
    </KeyboardAvoidingView>
  );
}
