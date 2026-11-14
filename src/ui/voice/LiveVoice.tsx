import { router } from 'expo-router';
import { useConvex } from 'convex/react';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildTools } from '@/lib/connectors/runtime';
import { LiveAudio } from '@/lib/live/audio';
import { LiveSession } from '@/lib/live/session';
import type { LiveState, LiveTool, WebSocketLike } from '@/lib/live/session';
import { pickLiveModel } from '@/lib/llm/modelOptions';
import { buildSystemPrompt } from '@/lib/projects';
import { liveRemoteApi } from '@/lib/remote/liveApi';
import { createRemoteTools } from '@/lib/remote/voiceTools';
import { useChat, newMessageId } from '@/store/chat';
import { DEFAULT_SYSTEM_PROMPT, readApiKey, useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme';
import { Button, Icon, Sheet, T } from '@/ui/components';

const LIVE_STYLE =
  'You are in a live spoken conversation, so answer out loud in short, natural sentences. ' +
  'Do not use markdown, bullet lists or code blocks unless the user asks to hear code; never read long output aloud, summarize it instead. ' +
  "When the user asks you to build, change or run something on their computer, use run_on_computer with a clear, self-contained task, " +
  'then use check_task to follow it and tell the user the result in plain words.';

type Phase = 'idle' | 'connecting' | 'live' | 'error';

const APPROVAL_TIMEOUT_MS = 60_000;

interface Approval {
  description: string;
  resolve: (allowed: boolean) => void;
}

const friendlyTool: Record<string, string> = {
  run_on_computer: 'Starting a task on your computer',
  check_task: 'Checking the task',
  cancel_task: 'Cancelling the task',
  list_computers: 'Looking up your computers',
  drive_search: 'Searching Drive',
  docs_read: 'Reading a document',
  sheets_read: 'Reading a spreadsheet',
  calendar_upcoming_events: 'Checking your calendar',
  drive_folder_list: 'Browsing the Drive folder',
  drive_folder_read: 'Reading a Drive file',
  github_list_dir: 'Browsing the repo',
  github_read_file: 'Reading a repo file',
  github_search_code: 'Searching the repo',
};

export function LiveVoice({ initialConversationId, onSwitchEngine }: { initialConversationId?: string; onSwitchEngine: () => void }) {
  const insets = useSafeAreaInsets();
  const voice = useSettings((s) => s.voice);
  const liveModels = useSettings((s) => s.liveModels);
  const convex = useConvex();

  const [phase, setPhase] = useState<Phase>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [userText, setUserText] = useState('');
  const [modelText, setModelText] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);

  const session = useRef<LiveSession | null>(null);
  const audio = useRef<LiveAudio | null>(null);
  const convId = useRef<string | null>(initialConversationId ?? null);
  const userBuf = useRef('');
  const modelBuf = useRef('');
  const modelId = useRef('gemini-live');
  const alive = useRef(true);

  // The screen must stay on, or the OS suspends the mic and the socket mid-conversation.
  useKeepAwake();

  const [pulse] = useState(() => new Animated.Value(0));
  const animating = phase === 'live' || phase === 'connecting';
  useEffect(() => {
    if (!animating) {
      pulse.setValue(0);
      return;
    }
    const period = speaking ? 500 : 1100;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: period, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: period, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animating, speaking, pulse]);

  /** Saves what was said as normal chat messages so the voice session shows up in history. */
  const commitTurn = useCallback(() => {
    const user = userBuf.current.trim();
    const model = modelBuf.current.trim();
    userBuf.current = '';
    modelBuf.current = '';
    if (!user && !model) return;
    if (!convId.current) convId.current = useChat.getState().createConversation(null).id;
    const now = Date.now();
    const messages = [];
    if (user) messages.push({ id: newMessageId(), role: 'user' as const, content: user, createdAt: now });
    if (model) messages.push({ id: newMessageId(), role: 'assistant' as const, content: model, createdAt: now + 1, modelId: modelId.current });
    useChat.getState().appendMessages(convId.current, messages);
  }, []);

  const requestApproval = useCallback(
    (description: string) =>
      new Promise<boolean>((resolve) => {
        let done = false;
        const settle = (allowed: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          setApproval(null);
          resolve(allowed);
        };
        // An unanswered prompt is a "no": never run something on the user's machine by default.
        const timer = setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS);
        setApproval({ description, resolve: settle });
      }),
    [],
  );

  const stop = useCallback(() => {
    session.current?.close();
    session.current = null;
    audio.current?.stop();
    audio.current = null;
    commitTurn();
    setSpeaking(false);
    setActivity(null);
    setApproval((a) => {
      a?.resolve(false);
      return null;
    });
    if (alive.current) setPhase('idle');
  }, [commitTurn]);

  const start = useCallback(async () => {
    setError(null);
    setUserText('');
    setModelText('');
    try {
      const apiKey = await readApiKey('gemini');
      if (!apiKey) throw new Error('Add a Gemini API key in Settings → Models to use Gemini Live.');
      const model = pickLiveModel(liveModels, voice.liveModel);
      if (!model) {
        throw new Error('No Gemini Live model found. Open Settings → Models → Gemini, tap “Update & refresh models”, then try again.');
      }
      modelId.current = `gemini:${model}`;
      setPhase('connecting');

      const conv = convId.current ? useChat.getState().conversations.find((c) => c.id === convId.current) : undefined;
      const project = conv ? (useChat.getState().projects.find((p) => p.id === conv.projectId) ?? null) : null;
      const tools: LiveTool[] = [...(await buildTools(project, true)), ...createRemoteTools(liveRemoteApi(convex))];
      const system = `${buildSystemPrompt(useSettings.getState().systemPrompt || DEFAULT_SYSTEM_PROMPT, project)}\n\n${LIVE_STYLE}`;

      const live = new LiveAudio();
      live.onSpeakingChange = (v) => alive.current && setSpeaking(v);
      await live.prepare(); // asks for the microphone before we open the network connection
      audio.current = live;

      const s = new LiveSession({
        apiKey,
        model,
        systemInstruction: system,
        tools,
        voiceName: voice.liveVoice,
        createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
        approve: (req) => requestApproval(req.description),
        handlers: {
          onAudio: (b64) => audio.current?.play(b64),
          onInterrupted: () => audio.current?.interrupt(),
          onInputTranscript: (t) => {
            userBuf.current += t;
            setUserText(userBuf.current);
          },
          onOutputTranscript: (t) => {
            modelBuf.current += t;
            setModelText(modelBuf.current);
          },
          onTurnComplete: commitTurn,
          onToolStart: (c) => setActivity(friendlyTool[c.name] ?? `Using ${c.name}`),
          onToolEnd: () => setActivity(null),
          onState: (st: LiveState) => {
            if (!alive.current) return;
            if (st === 'ready') setPhase('live');
            else if (st === 'reconnecting') setPhase('connecting');
          },
          onError: (e) => {
            if (!alive.current) return;
            setError(e.message);
            setPhase('error');
            audio.current?.stop();
            audio.current = null;
          },
        },
      });
      session.current = s;
      await s.connect();
      live.startMic((b64) => s.sendAudio(b64));
      setMuted(false);
    } catch (err) {
      session.current?.close();
      session.current = null;
      audio.current?.stop();
      audio.current = null;
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    }
  }, [convex, liveModels, voice.liveModel, voice.liveVoice, commitTurn, requestApproval]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.current?.close();
      audio.current?.stop();
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audio.current?.setMuted(next);
    if (next) session.current?.endAudioStream();
  };

  const label =
    phase === 'idle' ? 'Tap to start talking'
    : phase === 'connecting' ? 'Connecting…'
    : phase === 'error' ? 'Could not connect'
    : activity ? activity
    : muted ? 'Muted'
    : speaking ? 'Speaking… talk to interrupt'
    : 'Listening…';

  const orbColor = phase === 'error' ? colors.danger : phase === 'live' ? (speaking ? colors.success : colors.primary) : colors.surface2;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg }}>
        <Pressable onPress={onSwitchEngine} hitSlop={8} accessibilityRole="button" accessibilityLabel="Use classic voice instead">
          <T variant="small">Gemini Live  ·  Use classic voice</T>
        </Pressable>
        <Pressable
          onPress={() => {
            stop();
            router.back();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close voice mode"
        >
          <Icon name="close" size={26} />
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.xl }}>
        <Pressable
          onPress={phase === 'live' || phase === 'connecting' ? stop : () => void start()}
          accessibilityRole="button"
          accessibilityLabel={phase === 'live' ? 'End conversation' : 'Start conversation'}
        >
          <Animated.View style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: orbColor, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
            <Icon name={phase === 'live' ? (speaking ? 'volume-high' : 'mic') : phase === 'connecting' ? 'ellipsis-horizontal' : 'mic'} size={48} color={colors.text} />
          </Animated.View>
        </Pressable>
        <T variant="heading" style={{ textAlign: 'center' }}>{label}</T>
        {error ? <T variant="small" style={{ color: colors.danger, textAlign: 'center' }} selectable>{error}</T> : null}
        {userText ? <T style={{ textAlign: 'center', opacity: 0.7 }} numberOfLines={3}>{userText}</T> : null}
        {modelText ? <T variant="small" style={{ textAlign: 'center', color: colors.text, opacity: 0.85 }} numberOfLines={6}>{modelText}</T> : null}
      </View>

      {phase === 'live' ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
          <Pressable
            onPress={toggleMute}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'}
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: muted ? colors.danger : colors.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={muted ? 'mic-off' : 'mic'} size={24} />
          </Pressable>
          <Pressable
            onPress={stop}
            accessibilityRole="button"
            accessibilityLabel="End conversation"
            style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="call" size={24} />
          </Pressable>
        </View>
      ) : (
        <T variant="small" style={{ textAlign: 'center', paddingHorizontal: space.xl }}>
          Talk naturally and interrupt any time. The assistant can search your connected Drive, GitHub and, with your approval, run tasks on your computer.
        </T>
      )}

      <Sheet visible={!!approval} onClose={() => approval?.resolve(false)} title="Allow this action?">
        <View style={{ padding: space.lg, gap: space.lg }}>
          <View style={{ backgroundColor: colors.surface2, borderRadius: radius.md, padding: space.md }}>
            <T variant="mono" selectable>{approval?.description ?? ''}</T>
          </View>
          <T variant="small">The assistant wants to do this on your computer. It will only run if you allow it.</T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Deny" kind="secondary" onPress={() => approval?.resolve(false)} style={{ flex: 1 }} />
            <Button title="Allow" onPress={() => approval?.resolve(true)} style={{ flex: 1 }} />
          </View>
        </View>
      </Sheet>
    </View>
  );
}
