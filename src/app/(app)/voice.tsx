import { useLocalSearchParams } from 'expo-router';

import { useSettings } from '@/store/settings';
import { ClassicVoice } from '@/ui/voice/ClassicVoice';
import { LiveVoice } from '@/ui/voice/LiveVoice';

/** Chooses between Gemini Live (two-way audio with tools) and the classic recognise-then-speak loop. */
export default function VoiceScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const engine = useSettings((s) => s.voice.engine);
  const hasGeminiKey = useSettings((s) => !!s.hasKey.gemini);
  const updateVoice = useSettings((s) => s.updateVoice);

  // Live needs a Gemini key; without one, classic voice (which works with any model) is used.
  if (engine === 'live' && hasGeminiKey) {
    return <LiveVoice initialConversationId={id} onSwitchEngine={() => updateVoice({ engine: 'classic' })} />;
  }
  return (
    <ClassicVoice
      initialConversationId={id}
      onSwitchEngine={hasGeminiKey ? () => updateVoice({ engine: 'live' }) : undefined}
    />
  );
}
