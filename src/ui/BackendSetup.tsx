import { useState } from 'react';
import { View } from 'react-native';

import { getBackendHost, saveBackend } from '@/lib/supabase';
import { colors, space } from '@/theme';
import { Button, Card, Input, T } from './components';

/** Lets the user point the app at their own Supabase project (no rebuild needed). */
export function BackendSetup({ onDone }: { onDone?: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = getBackendHost();

  const save = async () => {
    setBusy(true);
    setError(null);
    const problem = await saveBackend(url, key);
    setBusy(false);
    if (problem) setError(problem);
    else {
      setKey('');
      onDone?.();
    }
  };

  return (
    <Card style={{ padding: space.lg, gap: space.md }}>
      <T style={{ fontWeight: '600' }}>{current ? 'Change backend' : 'Connect your Supabase project'}</T>
      <T variant="small">
        In Supabase, open Project Settings → API and copy the Project URL and the anon (public) key. Never paste the service-role or secret key.
      </T>
      <Input label="Project URL" value={url} onChangeText={setUrl} keyboardType="url" placeholder="https://abcd1234.supabase.co" />
      <Input label="Anon (publishable) key" value={key} onChangeText={setKey} placeholder="eyJ… or sb_publishable_…" secureTextEntry autoComplete="off" />
      {error ? <T variant="small" style={{ color: colors.danger }} selectable>{error}</T> : null}
      <View style={{ gap: space.sm }}>
        <Button title="Save and continue" onPress={save} loading={busy} disabled={!url.trim() || !key.trim()} />
      </View>
    </Card>
  );
}
