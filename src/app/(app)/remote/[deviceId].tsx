import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cancelTask, createTask, getTask, listEvents, listTasks, subscribeTask } from '@/lib/remote/api';
import { isFinal, lastEventId, mergeEvents, statusLabel, toSegments } from '@/lib/remote/model';
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

/**
 * Live output for one task: realtime pushes plus a polling safety net, merged by event id.
 * Mount it with `key={taskId}` so each task starts from fresh state.
 */
function useTaskStream(taskId: string, onTaskChange: (t: RemoteTask) => void) {
  const [task, setTask] = useState<RemoteTask | null>(null);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<RemoteEvent[]>([]);
  const onChangeRef = useRef(onTaskChange);
  useEffect(() => {
    onChangeRef.current = onTaskChange;
  }, [onTaskChange]);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval> | undefined;

    const addEvents = (incoming: RemoteEvent[]) => {
      const merged = mergeEvents(eventsRef.current, incoming);
      if (merged !== eventsRef.current) {
        eventsRef.current = merged;
        setEvents(merged);
      }
    };
    const update = (t: RemoteTask) => {
      setTask(t);
      onChangeRef.current(t);
    };

    const refresh = async () => {
      try {
        const [t, ev] = await Promise.all([getTask(taskId), listEvents(taskId, lastEventId(eventsRef.current))]);
        if (!alive) return;
        if (t) update(t);
        addEvents(ev);
        setError(null);
        // This fetch ran after the task finished, so every event is in: stop polling.
        if (t && isFinal(t.status) && poll) {
          clearInterval(poll);
          poll = undefined;
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };

    const first = setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeTask(taskId, {
      onEvent: (e) => addEvents([e]),
      onTask: (t) => {
        update(t);
        // A finished status can arrive before the last events; one more fetch closes the gap.
        if (isFinal(t.status)) void refresh();
      },
    });
    // Realtime can drop on flaky mobile networks, so also poll while the task is still active.
    poll = setInterval(() => void refresh(), 4000);
    return () => {
      alive = false;
      clearTimeout(first);
      unsubscribe();
      if (poll) clearInterval(poll);
    };
  }, [taskId]);

  return { task, events, error };
}

function TaskOutput({ taskId, onTaskChange, onError }: { taskId: string; onTaskChange: (t: RemoteTask) => void; onError: (m: string) => void }) {
  const { task, events, error } = useTaskStream(taskId, onTaskChange);
  const scroll = useRef<ScrollHandle | null>(null);
  const segments = useMemo(() => toSegments(events), [events]);
  const active = task && !isFinal(task.status);

  return (
    <View style={{ gap: space.sm }}>
      {task ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(task.status) }} />
          <T style={{ fontWeight: '600', flex: 1 }}>
            {statusLabel(task.status)}
            {task.exit_code !== null && task.status !== 'cancelled' ? ` (exit ${task.exit_code})` : ''}
          </T>
          {active ? (
            <Pressable onPress={() => cancelTask(task.id).catch((e: Error) => onError(e.message))} accessibilityRole="button" hitSlop={8}>
              <T style={{ color: colors.danger, fontWeight: '600' }}>Cancel</T>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ActivityIndicator color={colors.muted} />
      )}
      {task?.status === 'queued' ? <T variant="small">Queued. The task starts as soon as the companion on that computer picks it up.</T> : null}
      {error ? <T variant="small" style={{ color: colors.warning }}>Reconnecting… ({error})</T> : null}
      <ScrollView
        ref={(r) => {
          scroll.current = r as unknown as ScrollHandle | null;
        }}
        nestedScrollEnabled
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        style={{ maxHeight: 340, backgroundColor: '#050507', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
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
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listTasks(deviceId)
      .then((t) => alive && setTasks(t))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [deviceId]);

  // Keeps the history badges in step with the task being watched.
  const onTaskChange = (t: RemoteTask) => setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, ...t } : x)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createTask(deviceId, prompt);
      setPrompt('');
      setTasks((l) => [created, ...l]);
      setSelected(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        {selected ? (
          <TaskOutput key={selected} taskId={selected} onTaskChange={onTaskChange} onError={setError} />
        ) : (
          <T variant="small">Run a task below, or pick one from history.</T>
        )}

        <SectionTitle>History</SectionTitle>
        {tasks.length === 0 ? (
          <T variant="small">No tasks yet.</T>
        ) : (
          tasks.map((t) => (
            <Row
              key={t.id}
              title={t.prompt.replace(/\s+/g, ' ')}
              subtitle={`${statusLabel(t.status)} · ${new Date(t.created_at).toLocaleString()}`}
              right={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor(t.status) }} />}
              onPress={() => setSelected(t.id)}
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
