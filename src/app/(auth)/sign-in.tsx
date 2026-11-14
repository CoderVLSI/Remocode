import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyAuthError, validateEmail, validatePassword } from '@/lib/authValidation';
import { getBackendHost, isBackendConfigured } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { colors, space } from '@/theme';
import { BackendSetup } from '@/ui/BackendSetup';
import { Button, Input, Screen, T } from '@/ui/components';

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
  const [changingBackend, setChangingBackend] = useState(false);
  // Re-read after saving: the module state changes without a React render of its own.
  const [, bump] = useState(0);
  const configured = isBackendConfigured();

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
        <Image source={require('../../../assets/images/icon.png')} style={{ width: 72, height: 72, borderRadius: 18 }} accessibilityLabel="Remo Code logo" />
        <T variant="title">Remo Code</T>
        <T variant="small">Code beyond gravity. Sign in to sync your projects and computers.</T>
      </View>

      {!configured || changingBackend ? (
        <BackendSetup
          onDone={() => {
            setChangingBackend(false);
            bump((n) => n + 1);
          }}
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
        disabled={!configured}
      />

      {configured && !changingBackend ? (
        <Pressable onPress={() => setChangingBackend(true)} accessibilityRole="button" style={{ alignItems: 'center', padding: space.sm }}>
          <T variant="small">Backend: {getBackendHost()} · Change</T>
        </Pressable>
      ) : null}

      {mode === 'password' ? (
        <Pressable onPress={() => setCreating((c) => !c)} accessibilityRole="button" style={{ alignItems: 'center', padding: space.sm }}>
          <T style={{ color: colors.primary }}>{creating ? 'I already have an account' : 'Create an account'}</T>
        </Pressable>
      ) : null}
    </Screen>
  );
}
