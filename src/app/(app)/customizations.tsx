import { useState } from 'react';
import { Alert, Platform, Switch, View } from 'react-native';

import { connectGitHub, disconnectGitHub } from '@/lib/connectors/runtime';
import { connectGoogle, disconnectGoogle } from '@/lib/connectors/googleAuth';
import { useConnectors } from '@/store/connectors';
import { colors, space } from '@/theme';
import { Button, Card, Input, Row, Screen, SectionTitle, T } from '@/ui/components';

function GitHubCard() {
  const github = useConnectors((s) => s.github);
  const enabled = useConnectors((s) => s.enabled.github);
  const setEnabled = useConnectors((s) => s.setEnabled);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectGitHub(token);
      setToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row
        icon="logo-github"
        title="GitHub"
        subtitle={github.connected ? `Connected as ${github.login}` : 'Read repos, files and code search'}
        right={github.connected ? <Switch value={enabled} onValueChange={(v) => setEnabled('github', v)} trackColor={{ true: colors.primary }} /> : <View />}
      />
      <View style={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
        {github.connected ? (
          <>
            <T variant="small">The model can only read the repository attached to the current project. It cannot write, push or open pull requests.</T>
            <Button title="Disconnect" kind="danger" onPress={() => void disconnectGitHub()} />
          </>
        ) : (
          <>
            <T variant="small">
              Paste a personal access token. A fine-grained token with read-only “Contents” and “Metadata” access to just the repositories you want is safest.
            </T>
            <Input
              label="Personal access token"
              value={token}
              onChangeText={setToken}
              secureTextEntry
              placeholder="github_pat_…"
              error={error}
              autoComplete="off"
              textContentType="password"
            />
            <Button title="Connect GitHub" onPress={connect} loading={busy} disabled={!token.trim()} />
          </>
        )}
      </View>
    </Card>
  );
}

function GoogleCard() {
  const google = useConnectors((s) => s.google);
  const enabled = useConnectors((s) => s.enabled.google);
  const setEnabled = useConnectors((s) => s.setEnabled);
  const setGoogle = useConnectors((s) => s.setGoogle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectGoogle();
      setGoogle(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row
        icon="logo-google"
        title="Google Workspace"
        subtitle={google.connected ? 'Connected: Calendar, Drive, Docs, Sheets (read-only)' : 'Calendar, Drive, Docs and Sheets, read-only'}
        right={google.connected ? <Switch value={enabled} onValueChange={(v) => setEnabled('google', v)} trackColor={{ true: colors.primary }} /> : <View />}
      />
      <View style={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
        {error ? <T variant="small" style={{ color: colors.danger }}>{error}</T> : null}
        {google.connected ? (
          <Button
            title="Disconnect"
            kind="danger"
            onPress={() =>
              Alert.alert('Disconnect Google?', 'Access is revoked and tokens are removed from this device.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Disconnect',
                  style: 'destructive',
                  onPress: async () => {
                    await disconnectGoogle();
                    setGoogle(false);
                  },
                },
              ])
            }
          />
        ) : (
          <>
            <T variant="small">Only offered to models that support tools. Nothing is ever written or deleted.</T>
            <Button title="Connect Google" onPress={connect} loading={busy} />
          </>
        )}
      </View>
    </Card>
  );
}

export default function Customizations() {
  return (
    <Screen>
      <T variant="small">
        Connect services so the model can look things up for you. Connectors only work with cloud models that support tools; on-device models chat without them.
        {Platform.OS === 'android' ? '' : ''}
      </T>
      <SectionTitle>Connectors</SectionTitle>
      <GitHubCard />
      <GoogleCard />
    </Screen>
  );
}
