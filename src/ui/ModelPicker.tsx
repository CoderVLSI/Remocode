import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { LOCAL_CATALOG } from '@/lib/llm/localCatalog';
import { buildModelOptions, PROVIDER_LABELS, resolveSelection } from '@/lib/llm/modelOptions';
import type { ModelOption, ProviderId } from '@/lib/llm/types';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme';

import { Button, Icon, Row, Sheet, T } from './components';

/** Hook returning the options list and the effective selection (re-evaluated when settings change). */
export function useModels(): { options: ModelOption[]; selected: ModelOption | null } {
  const selectedModelId = useSettings((s) => s.selectedModelId);
  const hasKey = useSettings((s) => s.hasKey);
  const fetchedModels = useSettings((s) => s.fetchedModels);
  const extraModels = useSettings((s) => s.extraModels);
  const baseUrls = useSettings((s) => s.baseUrls);
  const localDownloads = useSettings((s) => s.localDownloads);
  const customLocalModels = useSettings((s) => s.customLocalModels);
  return useMemo(() => {
    const options = buildModelOptions({
      hasKey,
      fetchedModels,
      extraModels,
      baseUrls,
      localDownloads,
      localCatalog: [...LOCAL_CATALOG, ...customLocalModels],
    });
    return { options, selected: resolveSelection(options, selectedModelId) };
  }, [selectedModelId, hasKey, fetchedModels, extraModels, baseUrls, localDownloads, customLocalModels]);
}

export function ModelPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { options, selected } = useModels();
  const selectModel = useSettings((s) => s.selectModel);

  const groups = useMemo(() => {
    const map = new Map<ProviderId, ModelOption[]>();
    for (const o of options) map.set(o.providerId, [...(map.get(o.providerId) ?? []), o]);
    return [...map.entries()];
  }, [options]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Model">
      {options.length === 0 ? (
        <View style={{ padding: 24, gap: 12 }}>
          <T variant="small">No models yet. Add an API key (Gemini, Claude, OpenAI, …) or download an on-device model.</T>
          <Button
            title="Add a model"
            onPress={() => {
              onClose();
              router.push('/settings/models');
            }}
          />
        </View>
      ) : (
        <>
          {groups.map(([providerId, list]) => (
            <View key={providerId}>
              <T variant="small" style={{ paddingHorizontal: 16, paddingTop: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                {PROVIDER_LABELS[providerId]}
              </T>
              {list.map((o) => (
                <Row
                  key={o.id}
                  title={o.label}
                  subtitle={o.tools ? undefined : 'Chat only (no tools)'}
                  right={o.id === selected?.id ? <Icon name="checkmark" color={colors.primary} /> : <View />}
                  onPress={() => {
                    selectModel(o.id);
                    onClose();
                  }}
                />
              ))}
            </View>
          ))}
          <Row
            icon="options-outline"
            title="Manage models"
            onPress={() => {
              onClose();
              router.push('/settings/models');
            }}
          />
        </>
      )}
    </Sheet>
  );
}
