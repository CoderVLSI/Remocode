import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';

import { deleteDevice, listDevices, subscribeDevices } from '@/lib/remote/api';
import { isOnline } from '@/lib/remote/model';
import type { Device } from '@/lib/remote/model';
import { colors, radius, space } from '@/theme';
import { Banner, Card, Icon, Row, SectionTitle, T } from '@/ui/components';

export default function RemoteDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setDevices(await listDevices());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDevices((d) => d ?? []);
    }
  }, []);

  useEffect(() => {
    // Started from a timer callback, not synchronously in the effect body.
    const first = setTimeout(() => void load(), 0);
    const unsubscribe = subscribeDevices(() => void load());
    // Re-render periodically so the online dot goes grey when heartbeats stop.
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => {
      clearTimeout(first);
      unsubscribe();
      clearInterval(t);
    };
  }, [load]);

  const remove = (d: Device) =>
    Alert.alert(`Remove ${d.name}?`, 'The computer can register again the next time the companion runs.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDevice(d.id);
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        },
      },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.muted}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <T variant="small">Send tasks from your phone to an agent running on your computer, and watch the output live.</T>
      {error ? <Banner tone="error" title="Could not load devices" message={error} /> : null}

      <SectionTitle>Your computers</SectionTitle>
      {devices === null ? (
        <ActivityIndicator color={colors.muted} />
      ) : devices.length === 0 ? (
        <Card style={{ padding: space.lg, gap: space.sm }}>
          <T style={{ fontWeight: '600' }}>No computers connected yet</T>
          <T variant="small">On your computer, install and sign in with the same email:</T>
          <View style={{ backgroundColor: colors.surface2, borderRadius: radius.sm, padding: space.md }}>
            <T variant="mono" selectable>{'cd companion\nnpm install\nnode index.mjs login\nnode index.mjs run'}</T>
          </View>
          <T variant="small">See the README, “Remote Control”, for details. Pull down to refresh once it is running.</T>
        </Card>
      ) : (
        <Card>
          {devices.map((d) => {
            const online = isOnline(d);
            return (
              <Row
                key={d.id}
                icon={d.platform === 'darwin' ? 'logo-apple' : d.platform === 'win32' ? 'logo-windows' : 'desktop-outline'}
                title={d.name}
                subtitle={online ? 'Online' : `Offline · last seen ${new Date(d.last_seen_at).toLocaleString()}`}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: online ? colors.success : colors.border }} />
                    <Icon name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                }
                onLongPress={() => remove(d)}
                onPress={() => router.push({ pathname: '/remote/[deviceId]', params: { deviceId: d.id, name: d.name } })}
              />
            );
          })}
        </Card>
      )}
      {devices && devices.length > 0 ? (
        <T variant="small">Long-press a computer to remove it.</T>
      ) : null}
    </ScrollView>
  );
}
