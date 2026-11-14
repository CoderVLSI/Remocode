import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '@/store/auth';
import { colors } from '@/theme';

// Keep the splash up until the stored session has been read, so signed-in users never see the sign-in screen flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);
  const init = useAuth((s) => s.init);

  useEffect(() => init(), [init]);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
