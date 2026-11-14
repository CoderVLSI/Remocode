import { Stack } from 'expo-router';

import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Remocode' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      <Stack.Screen name="voice" options={{ title: 'Voice', presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings/models" options={{ title: 'Models' }} />
      <Stack.Screen name="customizations" options={{ title: 'Customizations' }} />
      <Stack.Screen name="remote/index" options={{ title: 'Remote Control' }} />
      <Stack.Screen name="remote/[deviceId]" options={{ title: 'Device' }} />
      <Stack.Screen name="project/new" options={{ title: 'New project', presentation: 'modal' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Project' }} />
    </Stack>
  );
}
