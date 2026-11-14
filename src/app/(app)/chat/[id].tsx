import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { retryLast, sendMessage, stopGeneration, useRuntime } from '@/lib/chatController';
import type { ChatMessage } from '@/lib/llm/types';
import { useChat } from '@/store/chat';
import { colors, radius, space } from '@/theme';
import { Banner, Empty, Icon, T } from '@/ui/components';
import { MessageBubble } from '@/ui/MessageBubble';
import { ModelPicker, useModels } from '@/ui/ModelPicker';

export default function ChatScreen() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  const insets = useSafeAreaInsets();
  const conversation = useChat((s) => s.conversations.find((c) => c.id === id));
  const project = useChat((s) => s.projects.find((p) => p.id === conversation?.projectId));
  const run = useRuntime((s) => s.runs[id]);
  const error = useRuntime((s) => s.errors[id]);
  const setError = useRuntime((s) => s.setError);
  const { selected } = useModels();

  const [text, setText] = useState(draft ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const generating = !!run;

  // Inverted list: newest at index 0 keeps the view pinned to the latest message while streaming.
  const data = useMemo(() => {
    const persisted = conversation?.messages ?? [];
    // The controller commits finished messages and then clears the live run; skip any
    // live message that is already persisted so a render between the two never shows it twice.
    const known = new Set(persisted.map((m) => m.id));
    const live: ChatMessage[] = (run?.produced ?? []).filter((m) => !known.has(m.id));
    return [...persisted, ...live].reverse();
  }, [conversation?.messages, run?.produced]);

  if (!conversation) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Empty icon="alert-circle-outline" title="Conversation not found" />
      </View>
    );
  }

  const send = () => {
    const value = text.trim();
    if (!value || generating) return;
    setText('');
    void sendMessage(conversation.id, value);
  };

  const lastIndexById = data.length ? data[0].id : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen
        options={{
          title: conversation.title,
          headerRight: () => (
            <Pressable onPress={() => router.push({ pathname: '/voice', params: { id: conversation.id } })} hitSlop={10} accessibilityLabel="Voice mode">
              <Icon name="mic-outline" />
            </Pressable>
          ),
        }}
      />

      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: space.md }}
        ListEmptyComponent={
          <View style={{ transform: [{ scaleY: -1 }] }}>
            <Empty
              icon="sparkles-outline"
              title={project ? project.name : 'Ask anything'}
              message={selected ? `Using ${selected.label}` : 'Pick a model to get started.'}
            />
          </View>
        }
        ListHeaderComponent={
          generating && !data[0]?.content && data[0]?.role !== 'tool' ? (
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, alignItems: 'flex-start' }}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            streaming={generating && item.id === lastIndexById && item.role === 'assistant'}
            onRetry={!generating && item.error && item.id === lastIndexById ? () => void retryLast(conversation.id) : undefined}
          />
        )}
      />

      {error?.kind === 'quota' ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Banner
            tone="warning"
            title="Model quota reached"
            message={error.message}
            onClose={() => setError(conversation.id, undefined)}
            actions={[
              { label: 'Select another model', onPress: () => setPickerOpen(true) },
              { label: 'Add API key', primary: true, onPress: () => router.push('/settings/models') },
            ]}
          />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: space.md, paddingBottom: Math.max(insets.bottom, space.md), paddingTop: space.sm, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.sm }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask anything"
            placeholderTextColor={colors.muted}
            multiline
            style={{ flex: 1, color: colors.text, fontSize: 16, maxHeight: 140, paddingHorizontal: space.sm, paddingVertical: space.sm }}
            accessibilityLabel="Message"
          />
          <Pressable
            onPress={generating ? () => stopGeneration(conversation.id) : send}
            disabled={!generating && !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={generating ? 'Stop' : 'Send'}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: generating || text.trim() ? colors.primary : colors.surface2,
            }}
          >
            <Icon name={generating ? 'stop' : 'arrow-up'} size={20} color={generating || text.trim() ? colors.primaryText : colors.muted} />
          </Pressable>
        </View>
        <Pressable onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Choose model" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: space.sm }}>
          <Icon name="hardware-chip-outline" size={16} color={colors.muted} />
          <T variant="small">{selected ? selected.label : 'Choose a model'}</T>
          <Icon name="chevron-down" size={14} color={colors.muted} />
        </Pressable>
      </View>

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
    </KeyboardAvoidingView>
  );
}
