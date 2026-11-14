import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sendMessage, stopGeneration } from '@/lib/chatController';
import { SentenceChunker } from '@/lib/voice/sentences';
import { useChat } from '@/store/chat';
import { useSettings } from '@/store/settings';
import { colors, space } from '@/theme';
import { Icon, T } from '@/ui/components';
import { useModels } from '@/ui/ModelPicker';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

const LABEL: Record<Phase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking… tap to interrupt',
  error: 'Something went wrong',
};

export function ClassicVoice({ initialConversationId, onSwitchEngine }: { initialConversationId?: string; onSwitchEngine?: () => void }) {
  const insets = useSafeAreaInsets();
  const voice = useSettings((s) => s.voice);
  const { selected } = useModels();

  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const convId = useRef<string | null>(initialConversationId ?? null);
  const alive = useRef(true);
  const handsFree = useRef(true);
  const finalText = useRef('');
  const pendingUtterances = useRef(0);
  const generationDone = useRef(false);
  const phaseRef = useRef<Phase>('idle');

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // Gentle pulsing orb: driven natively so it stays smooth while the JS thread streams tokens.
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: phase === 'listening' ? 700 : 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: phase === 'listening' ? 700 : 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    if (phase === 'idle' || phase === 'error') pulse.setValue(0);
    else loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const startListening = useCallback(async () => {
    if (!alive.current) return;
    setError(null);
    finalText.current = '';
    setTranscript('');
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone or speech recognition permission was denied. Enable it in system settings.');
      setPhaseBoth('error');
      return;
    }
    const onDevice = voice.onDeviceRecognition && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    setPhaseBoth('listening');
    ExpoSpeechRecognitionModule.start({
      lang: voice.language,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: onDevice,
    });
  }, [voice.language, voice.onDeviceRecognition, setPhaseBoth]);

  const finishSpeakingIfDone = useCallback(() => {
    if (!alive.current) return;
    if (generationDone.current && pendingUtterances.current <= 0 && phaseRef.current === 'speaking') {
      if (handsFree.current) void startListening();
      else setPhaseBoth('idle');
    }
  }, [startListening, setPhaseBoth]);

  const speak = useCallback(
    (sentence: string) => {
      pendingUtterances.current += 1;
      setPhaseBoth('speaking');
      const done = () => {
        pendingUtterances.current -= 1;
        finishSpeakingIfDone();
      };
      Speech.speak(sentence, { language: voice.language, rate: voice.rate, onDone: done, onStopped: done, onError: done });
    },
    [voice.language, voice.rate, finishSpeakingIfDone, setPhaseBoth],
  );

  const ask = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setPhaseBoth('idle');
        return;
      }
      if (!convId.current) {
        convId.current = useChat.getState().createConversation(null).id;
      }
      const id = convId.current;
      setPhaseBoth('thinking');
      setReply('');
      generationDone.current = false;
      pendingUtterances.current = 0;

      const chunker = new SentenceChunker();
      let spokenLength = 0;
      const result = await sendMessage(id, text, {
        onProduced: (produced) => {
          // Only the latest assistant text is spoken; earlier steps (tool calls) stay silent.
          const last = [...produced].reverse().find((m) => m.role === 'assistant');
          if (!last) return;
          setReply(last.content);
          const delta = last.content.slice(spokenLength);
          spokenLength = last.content.length;
          if (!delta || !voice.speak || !alive.current) return;
          for (const sentence of chunker.push(delta)) speak(sentence);
        },
      });

      const tail = voice.speak ? chunker.flush() : null;
      if (tail && alive.current) speak(tail);
      generationDone.current = true;

      if (result?.error && result.error.kind !== 'aborted') {
        setError(result.produced[result.produced.length - 1]?.error ?? result.error.message);
        setPhaseBoth('error');
        return;
      }
      if (!alive.current) return;
      if (pendingUtterances.current <= 0) {
        // Nothing to say (speech off or empty reply): go straight back to listening or idle.
        phaseRef.current = 'speaking';
        finishSpeakingIfDone();
      }
    },
    [voice.speak, speak, finishSpeakingIfDone, setPhaseBoth],
  );

  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results?.[0]?.transcript ?? '';
    setTranscript(t);
    if (e.isFinal) finalText.current = t;
  });
  useSpeechRecognitionEvent('end', () => {
    if (phaseRef.current !== 'listening') return;
    void ask(finalText.current);
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (phaseRef.current !== 'listening') return;
    // "no-speech" and "aborted" are normal when the user says nothing or taps away.
    if (e.error === 'no-speech' || e.error === 'aborted') {
      setPhaseBoth('idle');
      return;
    }
    setError(e.message || `Speech recognition failed (${e.error}).`);
    setPhaseBoth('error');
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handsFree.current = false;
      Speech.stop();
      ExpoSpeechRecognitionModule.abort();
      if (convId.current) stopGeneration(convId.current);
    };
  }, []);

  const onOrbPress = () => {
    handsFree.current = true;
    switch (phaseRef.current) {
      case 'listening':
        ExpoSpeechRecognitionModule.stop(); // finishes the utterance and triggers 'end'
        break;
      case 'thinking':
        if (convId.current) stopGeneration(convId.current);
        setPhaseBoth('idle');
        break;
      case 'speaking':
        Speech.stop();
        pendingUtterances.current = 0;
        if (convId.current) stopGeneration(convId.current);
        void startListening();
        break;
      default:
        void startListening();
    }
  };

  const orbColor = phase === 'error' ? colors.danger : phase === 'listening' ? colors.primary : phase === 'speaking' ? colors.success : colors.surface2;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg }}>
        <Pressable onPress={onSwitchEngine} disabled={!onSwitchEngine} hitSlop={8} accessibilityRole="button" accessibilityLabel="Switch to Gemini Live">
          <T variant="small">{selected ? selected.label : 'No model selected'}{onSwitchEngine ? '  ·  Switch to Gemini Live' : ''}</T>
        </Pressable>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close voice mode">
          <Icon name="close" size={26} />
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.xl }}>
        <Pressable onPress={onOrbPress} accessibilityRole="button" accessibilityLabel={LABEL[phase]}>
          <Animated.View
            style={{
              width: 150,
              height: 150,
              borderRadius: 75,
              backgroundColor: orbColor,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale }],
            }}
          >
            <Icon name={phase === 'speaking' ? 'volume-high' : phase === 'thinking' ? 'ellipsis-horizontal' : 'mic'} size={48} color={colors.text} />
          </Animated.View>
        </Pressable>
        <T variant="heading">{LABEL[phase]}</T>
        {error ? <T variant="small" style={{ color: colors.danger, textAlign: 'center' }} selectable>{error}</T> : null}
        {transcript && phase !== 'speaking' ? <T style={{ textAlign: 'center', opacity: 0.9 }}>{transcript}</T> : null}
        {reply && (phase === 'speaking' || phase === 'thinking') ? (
          <T variant="small" numberOfLines={6} style={{ textAlign: 'center', color: colors.text, opacity: 0.8 }}>
            {reply}
          </T>
        ) : null}
      </View>

      {!selected ? (
        <T variant="small" style={{ textAlign: 'center', paddingHorizontal: space.xl }}>
          Add an API key or download an on-device model in Settings → Models first.
        </T>
      ) : (
        <T variant="small" style={{ textAlign: 'center' }}>
          Replies are saved to the conversation. Voice recognition {voice.onDeviceRecognition ? 'prefers on-device processing' : 'may use your OS speech service'}.
        </T>
      )}
    </View>
  );
}
