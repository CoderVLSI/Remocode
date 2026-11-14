import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyAuthError, isCodeComplete, normalizeCode } from '@/lib/authValidation';
import { useAuth } from '@/store/auth';
import type { VerifyKind } from '@/store/auth';
import { colors, radius, space } from '@/theme';
import { Button, Screen, T } from '@/ui/components';

const RESEND_SECONDS = 30;
// Must match "Email OTP Length" in the Supabase dashboard (Auth -> Providers -> Email).
const CODE_LENGTH = Number(process.env.EXPO_PUBLIC_OTP_LENGTH) || 6;

export default function Verify() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email: string; kind?: string }>();
  const email = String(params.email ?? '');
  const kind: VerifyKind = params.kind === 'signup' ? 'signup' : 'email';
  const { verifyCode, sendCode } = useAuth();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const submitting = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string) => {
      if (submitting.current || !isCodeComplete(value, CODE_LENGTH)) return;
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        await verifyCode(email, value, kind);
        // The auth gate in the root layout navigates once the session arrives.
      } catch (err) {
        setError(friendlyAuthError(err as { message?: string; status?: number; code?: string }));
        setCode('');
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [email, kind, verifyCode],
  );

  const onChange = (text: string) => {
    const next = normalizeCode(text);
    setCode(next);
    // Submit automatically as soon as the code is complete (typed, pasted or autofilled).
    if (next.length === CODE_LENGTH) void submit(next);
  };

  const resend = async () => {
    setError(null);
    try {
      await sendCode(email);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(friendlyAuthError(err as { message?: string; status?: number; code?: string }));
    }
  };

  return (
    <Screen style={{ paddingTop: insets.top + space.xl, gap: space.lg }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
        <T style={{ color: colors.primary }}>‹ Back</T>
      </Pressable>
      <View style={{ gap: space.sm }}>
        <T variant="title">Check your email</T>
        <T variant="small">
          We sent a {CODE_LENGTH}-digit code to <T style={{ fontWeight: '600' }}>{email}</T>. Enter it below.
        </T>
      </View>

      <View>
        <TextInput
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH + 4}
          autoFocus
          editable={!busy}
          accessibilityLabel="Verification code"
          placeholder="000000"
          placeholderTextColor={colors.border}
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            color: colors.text,
            fontSize: 32,
            letterSpacing: 10,
            textAlign: 'center',
            paddingVertical: space.lg,
            fontVariant: ['tabular-nums'],
          }}
        />
      </View>

      {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}

      <Button title="Verify" onPress={() => submit(code)} loading={busy} disabled={!isCodeComplete(code, CODE_LENGTH)} />
      <Button
        title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        kind="ghost"
        onPress={resend}
        disabled={cooldown > 0 || busy}
      />
    </Screen>
  );
}
