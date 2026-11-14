import { useAction, useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';

import { api } from '../../../../convex/_generated/api';
import { formatCountdown, isOnline } from '@/lib/remote/model';
import type { Device } from '@/lib/remote/model';
import { colors, radius, space } from '@/theme';
import { Banner, Button, Card, Icon, Row, SectionTitle, Sheet, T } from '@/ui/components';

function PairingSheet({ code, expiresAt, onClose }: { code: string | null; expiresAt: number; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const left = expiresAt - now;
  const expired = left <= 0;

  return (
    <Sheet visible={code !== null} onClose={onClose} title="Pair a computer">
      <View style={{ padding: space.lg, gap: space.lg }}>
        <T variant="small">On your computer, open the companion folder and run:</T>
        <View style={{ backgroundColor: colors.surface2, borderRadius: radius.sm, padding: space.md }}>
          <T variant="mono" selectable>node index.mjs pair</T>
        </View>
        <T variant="small">Then enter this code when asked:</T>
        <View style={{ alignItems: 'center', paddingVertical: space.md, backgroundColor: colors.surface2, borderRadius: radius.md }}>
          <T style={{ fontSize: 40, fontWeight: '700', letterSpacing: 6, color: expired ? colors.muted : colors.text }} selectable>
            {code ?? ''}
          </T>
          <T variant="small" style={{ color: expired ? colors.danger : colors.muted }}>
            {expired ? 'Expired. Close this and make a new code.' : `Valid for ${formatCountdown(left)}, one use`}
          </T>
        </View>
        <Button title="Done" kind="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

export default function RemoteDevices() {
  // `undefined` while loading; the list updates by itself when a computer pairs or goes offline.
  const devices = useQuery(api.devices.list) as Device[] | undefined;
  const createCode = useAction(api.pairing.create);
  const removeDevice = useMutation(api.devices.remove);

  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Re-render periodically so the online dot goes grey when heartbeats stop.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const startPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      setPairing(await createCode({}));
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\[CONVEX [^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?/i, '') : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = (d: Device) =>
    Alert.alert(`Remove ${d.name}?`, 'Its task history is deleted and it stops working until you pair it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeDevice({ deviceId: d._id }).catch((e: Error) => setError(e.message)) },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <T variant="small">Send tasks from your phone to an agent running on your computer, and watch the output live.</T>
      {error ? <Banner tone="error" title="Something went wrong" message={error} onClose={() => setError(null)} /> : null}

      <Button title="Pair a computer" icon="link-outline" onPress={startPairing} loading={busy} />

      <SectionTitle>Your computers</SectionTitle>
      {devices === undefined ? (
        <ActivityIndicator color={colors.muted} />
      ) : devices.length === 0 ? (
        <Card style={{ padding: space.lg, gap: space.sm }}>
          <T style={{ fontWeight: '600' }}>No computers paired yet</T>
          <T variant="small">Tap “Pair a computer”, then run the companion on your computer and enter the code. See the README, “Remote Control”.</T>
        </Card>
      ) : (
        <Card>
          {devices.map((d) => {
            const online = isOnline(d);
            return (
              <Row
                key={d._id}
                icon={d.platform === 'darwin' ? 'logo-apple' : d.platform === 'win32' ? 'logo-windows' : 'desktop-outline'}
                title={d.name}
                subtitle={online ? 'Online' : `Offline · last seen ${new Date(d.lastSeenAt).toLocaleString()}`}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: online ? colors.success : colors.border }} />
                    <Icon name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                }
                onLongPress={() => remove(d)}
                onPress={() => router.push({ pathname: '/remote/[deviceId]', params: { deviceId: d._id, name: d.name } })}
              />
            );
          })}
        </Card>
      )}
      {devices && devices.length > 0 ? <T variant="small">Long-press a computer to remove it.</T> : null}

      <PairingSheet code={pairing?.code ?? null} expiresAt={pairing?.expiresAt ?? 0} onClose={() => setPairing(null)} />
    </ScrollView>
  );
}
