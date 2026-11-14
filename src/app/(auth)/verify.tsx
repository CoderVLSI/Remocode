import { useAuthActions } from '@convex-dev/auth/react';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyAuthError, isCodeComplete, normalizeCode } from '@/lib/authValidation';
import { colors, radius, space } from '@/theme';
import { Button, Screen, T } from '@/ui/components';

const RESEND_SECONDS = 30;
const CODE_LENGTH = 6; // matches convex/auth.ts

export default function Verify() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email: string; kind?: string }>();
  const email = String(params.email ?? '');
  const { signIn } = useAuthActions();

  // 'signup': confirming a new password account. 'code': passwordless sign-in. A resend always
  // switches to 'code', because that sign-in confirms the same email address.
  const [kind, setKind] = useState<'signup' | 'code'>(params.kind === 'signup' ? 'signup' : 'code');
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
        if (kind === 'signup') await signIn('password', { email, code: value, flow: 'email-verification' });
        else await signIn('resend-otp', { email, code: value });
        // The root layout navigates once the session arrives.
      } catch (err) {
        setError(friendlyAuthError(err, 'verifyCode'));
        setCode('');
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
    [email, kind, signIn],
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
      await signIn('resend-otp', { email });
      setKind('code');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(friendlyAuthError(err, 'sendCode'));
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
