import { Redirect, Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * The app's top-level navigation: signed-in screens and signed-out screens are separate groups,
 * and only the group matching the session exists at any moment.
 */
export function RootNavigator({ signedIn }: { signedIn: boolean }) {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * The route for "/" (where the app opens). It lives outside both groups so it always exists,
 * and sends the user to the right side of the app for their session.
 */
export function RootIndex({ signedIn }: { signedIn: boolean }) {
  return <Redirect href={signedIn ? '/home' : '/sign-in'} />;
}
