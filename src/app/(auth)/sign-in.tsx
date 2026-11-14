import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyAuthError, validateEmail, validatePassword } from '@/lib/authValidation';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { colors, space } from '@/theme';
import { Banner, Button, Icon, Input, Screen, T } from '@/ui/components';

type Mode = 'code' | 'password';

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { sendCode, signInWithPassword, signUpWithPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('code');
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const eErr = validateEmail(email);
    const pErr = mode === 'password' ? validatePassword(password) : null;
    setEmailError(eErr);
    setPasswordError(creating ? pErr : mode === 'password' && !password ? 'Enter your password.' : null);
    setFormError(null);
    if (eErr || (mode === 'password' && (creating ? pErr : !password))) return;

    setBusy(true);
    try {
      if (mode === 'code') {
        await sendCode(email);
        router.push({ pathname: '/verify', params: { email, kind: 'email' } });
      } else if (creating) {
        const needsCode = await signUpWithPassword(email, password);
        if (needsCode) router.push({ pathname: '/verify', params: { email, kind: 'signup' } });
      } else {
        await signInWithPassword(email, password);
      }
    } catch (err) {
      setFormError(friendlyAuthError(err as { message?: string; status?: number; code?: string }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: insets.top + space.xxl, gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Icon name="terminal" size={36} color={colors.primary} />
        <T variant="title">Remocode</T>
        <T variant="small">Your AI agent, on your phone. Sign in to sync projects and devices.</T>
      </View>

      {!isSupabaseConfigured ? (
        <Banner
          tone="warning"
          title="Supabase is not configured"
          message="Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart the dev server."
        />
      ) : null}

      <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 999, padding: 4 }}>
        {(['code', 'password'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => {
              setMode(m);
              setFormError(null);
            }}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 999,
              alignItems: 'center',
              backgroundColor: mode === m ? colors.surface2 : 'transparent',
            }}
          >
            <T style={{ fontWeight: '600', color: mode === m ? colors.text : colors.muted }}>
              {m === 'code' ? 'Email code' : 'Password'}
            </T>
          </Pressable>
        ))}
      </View>

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="you@example.com"
        error={emailError}
        onSubmitEditing={mode === 'code' ? submit : undefined}
        returnKeyType={mode === 'code' ? 'go' : 'next'}
      />

      {mode === 'password' ? (
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={creating ? 'new-password' : 'current-password'}
          textContentType={creating ? 'newPassword' : 'password'}
          placeholder={creating ? 'At least 8 characters' : 'Your password'}
          error={passwordError}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
      ) : (
        <T variant="small">We will email you a one-time code. No password to remember, and new accounts are created automatically.</T>
      )}

      {formError ? <T variant="small" style={{ color: colors.danger }} selectable>{formError}</T> : null}

      <Button
        title={mode === 'code' ? 'Email me a code' : creating ? 'Create account' : 'Sign in'}
        onPress={submit}
        loading={busy}
        disabled={!isSupabaseConfigured}
      />

      {mode === 'password' ? (
        <Pressable onPress={() => setCreating((c) => !c)} accessibilityRole="button" style={{ alignItems: 'center', padding: space.sm }}>
          <T style={{ color: colors.primary }}>{creating ? 'I already have an account' : 'Create an account'}</T>
        </Pressable>
      ) : null}
    </Screen>
  );
}
