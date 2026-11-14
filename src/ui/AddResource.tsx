import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { pickTextFiles } from '@/lib/uploadPicker';
import type { NewResource, ProjectResource } from '@/lib/projects';
import { useConnectors } from '@/store/connectors';
import { colors } from '@/theme';

import { Icon, Row, Sheet } from './components';
import { DrivePicker, RepoPicker } from './pickers';

/** Drive file ids already pinned, so the picker can mark them. */
export function pinnedDriveIds(resources: readonly (ProjectResource | NewResource)[]): Set<string> {
  const ids = new Set<string>();
  for (const r of resources) {
    if (r.kind === 'file' && r.source?.startsWith('drive:')) ids.add(r.source.slice('drive:'.length));
  }
  return ids;
}

export function resourceTitle(r: ProjectResource | NewResource): string {
  return r.kind === 'github' ? r.repo : r.name;
}

export function resourceSubtitle(r: ProjectResource | NewResource): string {
  switch (r.kind) {
    case 'github':
      return `GitHub repo · browsable by the model${r.ref ? ` · ${r.ref}` : ''}`;
    case 'drive-folder':
      return 'Google Drive folder · browsable by the model';
    case 'file': {
      const origin = r.source?.startsWith('drive:') ? 'Drive' : r.source?.startsWith('github:') ? 'GitHub' : 'Upload';
      return `${origin} · pinned · ${r.content.length.toLocaleString()} characters`;
    }
  }
}

export function resourceIcon(r: ProjectResource | NewResource): 'logo-github' | 'logo-google' | 'document-text-outline' {
  return r.kind === 'github' ? 'logo-github' : r.kind === 'drive-folder' || r.source?.startsWith('drive:') ? 'logo-google' : 'document-text-outline';
}

type Step = 'drive' | 'github' | null;

/**
 * The "Add Resource" menu: Google Drive, Upload Files, GitHub. Used both when creating a
 * project and later from the project screen.
 */
export function AddResourceSheet({
  visible,
  onClose,
  onAdd,
  existing,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (resource: NewResource) => void;
  existing: readonly (ProjectResource | NewResource)[];
}) {
  const [step, setStep] = useState<Step>(null);
  const googleConnected = useConnectors((s) => s.google.connected);
  const githubConnected = useConnectors((s) => s.github.connected);
  const hasRepo = existing.some((r) => r.kind === 'github');

  const close = () => {
    setStep(null);
    onClose();
  };

  const needConnect = (what: string) => {
    close();
    Alert.alert(`Connect ${what} first`, `Connect ${what} in Customizations, then add it here.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Customizations', onPress: () => router.push('/customizations') },
    ]);
  };

  const upload = async () => {
    close();
    try {
      const results = await pickTextFiles();
      if (!results) return;
      const rejected: string[] = [];
      for (const r of results) {
        if (r.ok) onAdd({ kind: 'file', name: r.name, content: r.content, source: 'upload' });
        else rejected.push(`${r.name}: ${r.reason}`);
      }
      if (rejected.length) Alert.alert('Some files were skipped', rejected.join('\n'));
    } catch (err) {
      Alert.alert('Could not add files', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Sheet visible={visible && step === null} onClose={close} title="Add resource">
        <Row
          icon="logo-google"
          title="Google Drive"
          subtitle={googleConnected ? 'Attach a folder or pin files' : 'Connect Google first'}
          onPress={() => (googleConnected ? setStep('drive') : needConnect('Google'))}
        />
        <Row icon="cloud-upload-outline" title="Upload files" subtitle="Text and code files from your phone" onPress={() => void upload()} />
        <Row
          icon="logo-github"
          title="GitHub"
          subtitle={hasRepo ? 'A repository is already attached' : githubConnected ? 'Attach a repository' : 'Connect GitHub first'}
          right={hasRepo ? <Icon name="checkmark" color={colors.success} /> : undefined}
          onPress={hasRepo ? undefined : () => (githubConnected ? setStep('github') : needConnect('GitHub'))}
        />
      </Sheet>

      <DrivePicker
        visible={visible && step === 'drive'}
        onClose={close}
        pinnedIds={pinnedDriveIds(existing)}
        onAttachFolder={(f) => onAdd({ kind: 'drive-folder', folderId: f.folderId, name: f.name })}
        onPinFile={(f) => onAdd({ kind: 'file', name: f.name, content: f.content, source: `drive:${f.id}` })}
      />
      <RepoPicker
        visible={visible && step === 'github'}
        onClose={close}
        onPick={(repo) => {
          onAdd({ kind: 'github', repo: repo.fullName, ref: repo.defaultBranch });
          close();
        }}
      />
    </>
  );
}
