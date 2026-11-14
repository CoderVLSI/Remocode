import { useState } from 'react';
import { Alert, View } from 'react-native';

import { errorFromException } from '@/lib/llm/errors';
import { LOCAL_CATALOG, customEntryFromUrl } from '@/lib/llm/localCatalog';
import type { LocalCatalogEntry } from '@/lib/llm/localCatalog';
import { KEYED_PROVIDERS, PROVIDER_LABELS } from '@/lib/llm/modelOptions';
import { refreshModels } from '@/lib/llm/registry';
import type { ProviderId } from '@/lib/llm/types';
import { useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { colors, space } from '@/theme';
import { Button, Card, Icon, Input, Row, Screen, SectionTitle, T } from '@/ui/components';

const KEY_HELP: Record<string, string> = {
  gemini: 'Get a free key at aistudio.google.com/apikey',
  anthropic: 'Create a key at console.anthropic.com',
  openai: 'Create a key at platform.openai.com/api-keys',
  openrouter: 'Create a key at openrouter.ai/keys. One key reaches many models.',
  custom: 'Any OpenAI-compatible server: Ollama, LM Studio, vLLM, Groq, Together… The key is optional for local servers.',
};

// A module-level empty list: a selector that returns a fresh `[]` every call makes zustand re-render forever.
const NO_MODELS: string[] = [];

function ProviderCard({ provider }: { provider: Exclude<ProviderId, 'local'> }) {
  const hasKey = useSettings((s) => !!s.hasKey[provider]);
  const baseUrl = useSettings((s) => (provider === 'openai' || provider === 'custom' ? s.baseUrls[provider] : undefined));
  const extra = useSettings((s) => s.extraModels[provider] ?? NO_MODELS);
  const fetched = useSettings((s) => s.fetchedModels[provider]?.length ?? 0);
  const { saveApiKey, removeApiKey, setBaseUrl, addExtraModel, removeExtraModel } = useSettings.getState();

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(baseUrl ?? '');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const isCustom = provider === 'custom';
  const status = isCustom ? (baseUrl ? 'Configured' : 'Not set up') : hasKey ? 'Key saved' : 'Add key';

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (provider === 'openai' || isCustom) {
        if (isCustom && !/^https?:\/\//i.test(url.trim())) throw new Error('Enter a base URL such as http://192.168.1.20:11434/v1');
        if (url.trim() || isCustom) setBaseUrl(provider, url);
      }
      if (key.trim()) await saveApiKey(provider, key);
      else if (!isCustom && !hasKey) throw new Error('Paste an API key first.');
      setKey('');
      try {
        const n = await refreshModels(provider);
        setMessage({ text: n ? `Connected. ${n} models available.` : 'Saved.', ok: true });
      } catch (err) {
        const e = errorFromException(err);
        if (e.kind === 'auth') {
          // Never keep a key the provider just rejected.
          await removeApiKey(provider);
          setMessage({ text: 'The provider rejected this key. Check it and try again.', ok: false });
        } else {
          setMessage({ text: `Saved, but could not list models (${e.message}). You can add model names manually.`, ok: false });
        }
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row
        title={PROVIDER_LABELS[provider]}
        subtitle={fetched ? `${status} · ${fetched} models` : status}
        right={<Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={hasKey || baseUrl ? colors.success : colors.muted} />}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <View style={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
          <T variant="small">{KEY_HELP[provider]}</T>
          {provider === 'openai' || isCustom ? (
            <Input
              label={isCustom ? 'Base URL' : 'Base URL (optional)'}
              value={url}
              onChangeText={setUrl}
              keyboardType="url"
              placeholder={isCustom ? 'http://192.168.1.20:11434/v1' : 'https://api.openai.com/v1'}
            />
          ) : null}
          <Input
            label={isCustom ? 'API key (optional)' : hasKey ? 'Replace API key' : 'API key'}
            value={key}
            onChangeText={setKey}
            secureTextEntry
            placeholder={hasKey ? '••••••••••••' : 'Paste your key'}
            textContentType="password"
            autoComplete="off"
          />
          {message ? <T variant="small" style={{ color: message.ok ? colors.success : colors.danger }}>{message.text}</T> : null}
          <Button title={hasKey || baseUrl ? 'Update & refresh models' : 'Save & connect'} onPress={save} loading={busy} />

          <Input label="Add a model by name" value={model} onChangeText={setModel} placeholder="e.g. my-fine-tune" onSubmitEditing={() => { addExtraModel(provider, model); setModel(''); }} />
          {extra.map((m) => (
            <Row key={m} title={m} icon="hardware-chip-outline" right={<Icon name="close" size={18} color={colors.muted} />} onPress={() => removeExtraModel(provider, m)} />
          ))}

          {hasKey || baseUrl ? (
            <Button
              title="Remove"
              kind="danger"
              onPress={() =>
                Alert.alert(`Remove ${PROVIDER_LABELS[provider]}?`, 'The key is deleted from this device.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                      await removeApiKey(provider);
                      if (provider === 'openai' || isCustom) setBaseUrl(provider, '');
                      setUrl('');
                    },
                  },
                ])
              }
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function formatBytes(n: number): string {
  if (!n) return '';
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

function LocalModelRow({ entry }: { entry: LocalCatalogEntry }) {
  const installed = useSettings((s) => s.localDownloads[entry.id]);
  const progress = useDownloads((s) => s.progress[entry.id]);
  const error = useDownloads((s) => s.errors[entry.id]);
  const { start, cancel, remove } = useDownloads.getState();
  const downloading = progress !== undefined;

  const subtitle = downloading
    ? `Downloading… ${Math.round(progress * 100)}%`
    : error
      ? error
      : installed
        ? `Installed · ${formatBytes(installed.sizeBytes)}`
        : `${entry.description}${entry.sizeBytes ? ` · ${formatBytes(entry.sizeBytes)}` : ''}`;

  return (
    <Row
      icon={installed ? 'checkmark-circle' : 'phone-portrait-outline'}
      title={entry.name}
      subtitle={subtitle}
      right={
        downloading ? (
          <Icon name="close-circle-outline" color={colors.muted} />
        ) : installed ? (
          <Icon name="trash-outline" color={colors.danger} />
        ) : (
          <Icon name="download-outline" color={colors.primary} />
        )
      }
      onPress={() => {
        if (downloading) cancel(entry.id);
        else if (installed) {
          Alert.alert(`Delete ${entry.name}?`, 'You can download it again later.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void remove(entry) },
          ]);
        } else start(entry);
      }}
    />
  );
}

export default function ModelsSettings() {
  const customLocal = useSettings((s) => s.customLocalModels);
  const start = useDownloads((s) => s.start);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  const addCustom = () => {
    const entry = customEntryFromUrl(url);
    if ('error' in entry) return setUrlError(entry.error);
    setUrlError(null);
    setUrl('');
    start(entry);
  };

  return (
    <Screen>
      <T variant="small">Bring your own keys, or run models fully on your phone. Keys are stored in the device’s secure storage and never sent anywhere except the provider you choose.</T>

      <SectionTitle>Cloud (bring your own key)</SectionTitle>
      {KEYED_PROVIDERS.map((p) => (
        <ProviderCard key={p} provider={p} />
      ))}

      <SectionTitle>On-device</SectionTitle>
      <T variant="small">Runs offline and privately. Smaller models are faster; 3B models want a recent phone with 6 GB+ RAM. Downloads use Wi-Fi data, so check your connection.</T>
      <Card>
        {[...LOCAL_CATALOG, ...customLocal].map((entry) => (
          <LocalModelRow key={entry.id} entry={entry} />
        ))}
      </Card>
      <Input
        label="Add a GGUF model by URL"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        placeholder="https://huggingface.co/…/model-Q4_K_M.gguf"
        error={urlError}
        onSubmitEditing={addCustom}
      />
      <Button title="Download from URL" kind="secondary" icon="link-outline" onPress={addCustom} disabled={!url.trim()} />
    </Screen>
  );
}
