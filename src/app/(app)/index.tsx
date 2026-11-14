import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { buildHomeItems, relativeTime } from '@/lib/homeItems';
import type { HomeItem } from '@/lib/homeItems';
import { useChat } from '@/store/chat';
import { colors, space } from '@/theme';
import { Empty, Icon, Input, Row, T } from '@/ui/components';

export default function Home() {
  const projects = useChat((s) => s.projects);
  const conversations = useChat((s) => s.conversations);
  const createConversation = useChat((s) => s.createConversation);
  const deleteConversation = useChat((s) => s.deleteConversation);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');

  const items = useMemo(
    () => buildHomeItems(projects, conversations, { expanded, query }),
    [projects, conversations, expanded, query],
  );

  const newChat = (projectId: string | null) => {
    const conv = createConversation(projectId);
    router.push({ pathname: '/chat/[id]', params: { id: conv.id } });
  };

  const confirmDelete = (id: string, title: string) =>
    Alert.alert('Delete conversation?', title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteConversation(id) },
    ]);

  const renderItem = ({ item }: { item: HomeItem }) => {
    switch (item.type) {
      case 'project':
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Row
                icon="cloud-outline"
                title={item.project.name}
                subtitle={item.project.resources.length ? `${item.project.resources.length} resource(s)` : undefined}
                onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.project.id } })}
                right={<View />}
              />
            </View>
            <Pressable
              onPress={() => newChat(item.project.id)}
              hitSlop={10}
              accessibilityLabel={`New conversation in ${item.project.name}`}
              style={{ padding: space.lg }}
            >
              <Icon name="add" color={colors.muted} />
            </Pressable>
          </View>
        );
      case 'conversation':
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.conversation.id } })}
            onLongPress={() => confirmDelete(item.conversation.id, item.conversation.title)}
            accessibilityHint="Long press to delete"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
              paddingLeft: item.indented ? space.xxl + space.lg : space.lg,
              paddingRight: space.lg,
              backgroundColor: pressed ? colors.surface : 'transparent',
            })}
          >
            <T numberOfLines={1} style={{ flex: 1 }}>{item.conversation.title}</T>
            <T variant="small">{relativeTime(item.conversation.updatedAt)}</T>
          </Pressable>
        );
      case 'more':
        return (
          <Pressable
            onPress={() => setExpanded(new Set([...expanded, item.projectId]))}
            style={{ paddingVertical: space.sm, paddingLeft: space.xxl + space.lg }}
          >
            <T variant="small" style={{ color: colors.primary }}>Show {item.hidden} more</T>
          </Pressable>
        );
      case 'header':
        return (
          <T variant="small" style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {item.title}
          </T>
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Settings">
                <Icon name="settings-outline" />
              </Pressable>
            </View>
          ),
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingTop: space.sm }}>
            <Row icon="grid-outline" title="Customizations" subtitle="Connectors and tools" onPress={() => router.push('/customizations')} />
            <Row icon="rocket-outline" title="Remote Control" subtitle="Run your agent on your computer" onPress={() => router.push('/remote')} />
            <Row icon="mic-outline" title="Voice mode" subtitle="Talk hands-free" onPress={() => router.push('/voice')} />
            {conversations.length + projects.length > 6 ? (
              <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
                <Input placeholder="Search chats and projects" value={query} onChangeText={setQuery} autoCapitalize="none" />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.lg }}>
              <T variant="small" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>Projects</T>
              <Pressable onPress={() => router.push('/project/new')} hitSlop={10} accessibilityLabel="New project">
                <Icon name="folder-open-outline" size={20} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Empty
            icon="chatbubbles-outline"
            title={query ? 'No matches' : 'No conversations yet'}
            message={query ? undefined : 'Tap the + below to start a chat, or create a project to attach a GitHub repo.'}
          />
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
      <Pressable
        onPress={() => newChat(null)}
        accessibilityRole="button"
        accessibilityLabel="New chat"
        style={({ pressed }) => ({
          position: 'absolute',
          right: space.xl,
          bottom: space.xxl,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          elevation: 6,
        })}
      >
        <Icon name="chatbubble-ellipses" color={colors.primaryText} />
      </Pressable>
    </View>
  );
}
