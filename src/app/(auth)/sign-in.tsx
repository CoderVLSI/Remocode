import { useAuthActions } from '@convex-dev/auth/react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyAuthError, validateEmail, validatePassword } from '@/lib/authValidation';
import { backendHost, useBackend } from '@/store/backend';
import { colors, space } from '@/theme';
import { BackendSetup } from '@/ui/BackendSetup';
import { Button, Input, Screen, T } from '@/ui/components';

type Mode = 'password' | 'code';

function Header() {
  return (
    <View style={{ gap: space.sm }}>
      <Image source={require('../../../assets/images/icon.png')} style={{ width: 72, height: 72, borderRadius: 18 }} accessibilityLabel="Remo Code logo" />
      <T variant="title">Remo Code</T>
      <T variant="small">Code beyond gravity. Sign in to sync your projects and computers.</T>
    </View>
  );
}

/** Only rendered once a backend exists, because it needs the Convex auth provider. */
function SignInForm({ onChangeBackend }: { onChangeBackend: () => void }) {
  const { signIn } = useAuthActions();
  const host = backendHost(useBackend((s) => s.url));
  const [mode, setMode] = useState<Mode>('password');
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const eErr = validateEmail(email);
    const pErr = mode === 'password' ? (creating ? validatePassword(password) : password ? null : 'Enter your password.') : null;
    setEmailError(eErr);
    setPasswordError(pErr);
    setFormError(null);
    if (eErr || pErr) return;

    const address = email.trim().toLowerCase();
    setBusy(true);
    try {
      if (mode === 'code') {
        await signIn('resend-otp', { email: address });
        router.push({ pathname: '/verify', params: { email: address, kind: 'code' } });
      } else if (creating) {
        const result = await signIn('password', { email: address, password, flow: 'signUp' });
        // When the backend sends email codes, a new account must confirm its email before it is signed in.
        if (!result.signingIn) router.push({ pathname: '/verify', params: { email: address, kind: 'signup' } });
      } else {
        await signIn('password', { email: address, password, flow: 'signIn' });
      }
      // On success the root layout notices the new session and moves to the app.
    } catch (err) {
      const step = mode === 'code' ? 'sendCode' : creating ? 'signUp' : 'signIn';
      setFormError(friendlyAuthError(err, step));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 999, padding: 4 }}>
        {(['password', 'code'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => {
              setMode(m);
              setFormError(null);
            }}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center', backgroundColor: mode === m ? colors.surface2 : 'transparent' }}
          >
            <T style={{ fontWeight: '600', color: mode === m ? colors.text : colors.muted }}>{m === 'password' ? 'Password' : 'Email code'}</T>
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
        <T variant="small">We will email you a one-time code. This needs email sending (Resend) to be set up on your backend; if it is not, use your password.</T>
      )}

      {formError ? <T variant="small" style={{ color: colors.danger }} selectable>{formError}</T> : null}

      <Button title={mode === 'code' ? 'Email me a code' : creating ? 'Create account' : 'Sign in'} onPress={submit} loading={busy} />

      {mode === 'password' ? (
        <Pressable onPress={() => setCreating((c) => !c)} accessibilityRole="button" style={{ alignItems: 'center', padding: space.sm }}>
          <T style={{ color: colors.primary }}>{creating ? 'I already have an account' : 'Create an account'}</T>
        </Pressable>
      ) : null}

      <Pressable onPress={onChangeBackend} accessibilityRole="button" style={{ alignItems: 'center', padding: space.sm }}>
        <T variant="small">Backend: {host} · Change</T>
      </Pressable>
    </>
  );
}

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const url = useBackend((s) => s.url);
  const [changing, setChanging] = useState(false);

  return (
    <Screen style={{ paddingTop: insets.top + space.xxl, gap: space.lg }}>
      <Header />
      {!url || changing ? <BackendSetup onDone={() => setChanging(false)} /> : null}
      {url && !changing ? <SignInForm onChangeBackend={() => setChanging(true)} /> : null}
    </Screen>
  );
}
