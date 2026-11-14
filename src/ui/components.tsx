import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, radius, space } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function T({
  variant = 'body',
  style,
  children,
  numberOfLines,
  selectable,
}: {
  variant?: keyof typeof font;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text style={[font[variant], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const bg =
    kind === 'primary' ? colors.primary : kind === 'danger' ? 'transparent' : kind === 'secondary' ? colors.surface2 : 'transparent';
  const fg = kind === 'primary' ? colors.primaryText : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: inactive ? 0.5 : pressed ? 0.8 : 1 },
        kind === 'danger' && { borderWidth: 1, borderColor: colors.danger },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; error?: string | null }) {
  const { label, error, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      {label ? <T variant="small">{label}</T> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
      />
      {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}
    </View>
  );
}

/** Keyboard-aware screen body with consistent padding. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && { padding: space.lg }, { paddingBottom: insets.bottom + space.xl, gap: space.md }, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: space.lg }, style]}>{children}</View>
  );
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({
  title,
  subtitle,
  icon,
  right,
  onPress,
  onLongPress,
  danger,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && onPress ? { backgroundColor: colors.surface2 } : null]}
    >
      {icon ? <Icon name={icon} color={danger ? colors.danger : colors.muted} /> : null}
      <View style={{ flex: 1 }}>
        <T style={danger ? { color: colors.danger } : undefined} numberOfLines={1}>{title}</T>
        {subtitle ? <T variant="small" numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-forward" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <T variant="small" style={{ marginTop: space.md, textTransform: 'uppercase', letterSpacing: 0.8 }}>{children}</T>;
}

export function Banner({
  tone = 'info',
  title,
  message,
  actions,
  onClose,
}: {
  tone?: 'info' | 'warning' | 'error';
  title: string;
  message?: string;
  actions?: { label: string; onPress: () => void; primary?: boolean }[];
  onClose?: () => void;
}) {
  const accent = tone === 'error' ? colors.danger : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <View style={[styles.banner, { borderColor: colors.border }]} accessibilityRole="alert">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name={tone === 'info' ? 'information-circle' : 'warning'} size={18} color={accent} />
        <T style={{ fontWeight: '600', flex: 1 }}>{title}</T>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Dismiss">
            <Icon name="close" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {message ? <T variant="small" style={{ color: colors.text, opacity: 0.85 }}>{message}</T> : null}
      {actions?.length ? (
        <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <Button key={a.label} title={a.label} kind={a.primary ? 'primary' : 'secondary'} onPress={a.onPress} style={styles.smallButton} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Bottom sheet built on Modal so it needs no extra native dependency. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.grabber} />
        {title ? <T variant="heading" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>{title}</T> : null}
        <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Empty({ icon, title, message }: { icon: IconName; title: string; message?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space.sm, padding: space.xxl }}>
      <Icon name={icon} size={36} color={colors.muted} />
      <T variant="heading">{title}</T>
      {message ? <T variant="small" style={{ textAlign: 'center' }}>{message}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  smallButton: { minHeight: 38, paddingHorizontal: space.lg },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 56,
  },
  banner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  overlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: space.md,
  },
});
