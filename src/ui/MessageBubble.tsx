import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import Markdown from 'react-native-markdown-display';

import type { ChatMessage } from '@/lib/llm/types';
import { colors, font, radius, space } from '@/theme';

import { Icon, T } from './components';

const markdownStyles = {
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  link: { color: colors.primary },
  code_inline: { backgroundColor: colors.surface2, color: colors.text, borderRadius: 4, paddingHorizontal: 4, fontFamily: 'monospace' },
  code_block: { backgroundColor: colors.surface2, borderColor: colors.border, borderRadius: radius.sm, padding: space.md, ...font.mono },
  fence: { backgroundColor: colors.surface2, borderColor: colors.border, borderRadius: radius.sm, padding: space.md, ...font.mono },
  blockquote: { backgroundColor: colors.surface, borderLeftColor: colors.border, borderLeftWidth: 3, paddingHorizontal: space.md },
  hr: { backgroundColor: colors.border },
  heading1: { color: colors.text, fontSize: 22, fontWeight: '700' as const, marginVertical: 6 },
  heading2: { color: colors.text, fontSize: 19, fontWeight: '700' as const, marginVertical: 6 },
  heading3: { color: colors.text, fontSize: 17, fontWeight: '600' as const, marginVertical: 4 },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  table: { borderColor: colors.border },
  tr: { borderColor: colors.border },
  th: { color: colors.text },
  td: { color: colors.text },
};

async function copy(text: string) {
  if (!text) return;
  await Clipboard.setStringAsync(text);
  Haptics.selectionAsync().catch(() => {});
}

function MessageBubbleImpl({
  message,
  streaming,
  onRetry,
}: {
  message: ChatMessage;
  streaming?: boolean;
  onRetry?: () => void;
}) {
  if (message.role === 'tool') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: 2 }}>
        <Icon name="checkmark-circle-outline" size={14} color={colors.muted} />
        <T variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {message.toolName} · {message.content.length.toLocaleString()} characters
        </T>
      </View>
    );
  }

  if (message.role === 'user') {
    return (
      <View style={{ alignItems: 'flex-end', paddingHorizontal: space.lg, paddingVertical: space.xs }}>
        <Pressable
          onLongPress={() => copy(message.content)}
          style={{ maxWidth: '85%', backgroundColor: colors.userBubble, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md }}
        >
          <T selectable>{message.content}</T>
        </Pressable>
      </View>
    );
  }

  const calls = message.toolCalls ?? [];
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.xs, gap: space.sm }}>
      {calls.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="construct-outline" size={14} color={colors.muted} />
          <T variant="small" numberOfLines={1} style={{ flex: 1 }}>
            {c.name}({Object.values(c.args).map((v) => JSON.stringify(v)).join(', ')})
          </T>
        </View>
      ))}
      {message.content ? (
        <Pressable onLongPress={() => copy(message.content)}>
          {/* Streaming text is plain until complete: re-parsing markdown per token is slow on phones. */}
          {streaming ? <T selectable>{message.content}</T> : <Markdown style={markdownStyles}>{message.content}</Markdown>}
        </Pressable>
      ) : null}
      {message.error ? (
        <View style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
          <T variant="small" style={{ color: colors.danger }} selectable>{message.error}</T>
          {onRetry ? (
            <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8}>
              <T variant="small" style={{ color: colors.primary, fontWeight: '600' }}>Retry</T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {message.modelId && !streaming && message.content ? (
        <T variant="small" style={{ opacity: 0.6 }}>{message.modelId.replace(/^[^:]+:/, '')}</T>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);
