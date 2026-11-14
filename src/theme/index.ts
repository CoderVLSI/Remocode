export const colors = {
  bg: '#0B0B0F',
  surface: '#15151B',
  surface2: '#1E1E27',
  border: '#2A2A35',
  text: '#F2F2F5',
  muted: '#8E8E9A',
  primary: '#4C8DFF',
  primaryText: '#FFFFFF',
  danger: '#FF6B6B',
  success: '#4ADE80',
  warning: '#FBBF24',
  userBubble: '#1F2A44',
  overlay: 'rgba(0,0,0,0.55)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const font = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.text },
};
