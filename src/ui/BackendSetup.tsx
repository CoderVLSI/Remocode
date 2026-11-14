import { useState } from 'react';

import { backendHost, useBackend } from '@/store/backend';
import { colors, space } from '@/theme';
import { Button, Card, Input, T } from './components';

/** Lets the user point the app at their own Convex deployment (no rebuild needed). */
export function BackendSetup({ onDone }: { onDone?: () => void }) {
  const current = backendHost(useBackend((s) => s.url));
  const save = useBackend((s) => s.save);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await save(url);
    setBusy(false);
    if (problem) setError(problem);
    else onDone?.();
  };

  return (
    <Card style={{ padding: space.lg, gap: space.md }}>
      <T style={{ fontWeight: '600' }}>{current ? 'Change backend' : 'Connect your Convex backend'}</T>
      <T variant="small">
        Run <T variant="mono">npx convex dev</T> once in the project, then paste the deployment URL it prints (it ends in .convex.cloud). It is
        public by design; access is protected by sign-in.
      </T>
      <Input
        label="Deployment URL"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        placeholder="https://your-name-123.convex.cloud"
        error={error}
        onSubmitEditing={submit}
      />
      {current ? <T variant="small" style={{ color: colors.muted }}>Currently: {current}</T> : null}
      <Button title="Save and continue" onPress={submit} loading={busy} disabled={!url.trim()} />
    </Card>
  );
}
