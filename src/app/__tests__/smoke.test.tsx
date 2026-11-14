/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories and screen modules are loaded with require on purpose */
/**
 * Smoke test: renders the app's real screens (not stand-ins) with native modules mocked, signed
 * out and signed in, so a screen that crashes on open fails here instead of on a phone.
 */
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { useAuth } from '@/store/auth';
import { useChat } from '@/store/chat';
import { useConnectors } from '@/store/connectors';
import { useSettings } from '@/store/settings';
import { RootIndex, RootNavigator } from '@/ui/RootNavigator';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    deleteItemAsync: async (k: string) => void store.delete(k),
  };
});
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('llama.rn', () => ({ initLlama: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    supportsOnDeviceRecognition: jest.fn(() => true),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));
jest.mock('@speechmatics/expo-two-way-audio', () => ({
  addExpoTwoWayAudioEventListener: jest.fn(() => ({ remove: jest.fn() })),
  initialize: jest.fn(),
  playPCMData: jest.fn(),
  requestMicrophonePermissionsAsync: jest.fn(async () => ({ granted: true })),
  tearDown: jest.fn(),
  toggleRecording: jest.fn(),
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })) }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-auth-session', () => ({ AuthRequest: jest.fn(), ResponseType: { Code: 'code' } }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

const files = {
  _layout: function Root() {
    const signedIn = useAuth((s) => !!s.session);
    return <RootNavigator signedIn={signedIn} />;
  },
  index: function Index() {
    const signedIn = useAuth((s) => !!s.session);
    return <RootIndex signedIn={signedIn} />;
  },
  '(auth)/_layout': require('../(auth)/_layout').default,
  '(auth)/sign-in': require('../(auth)/sign-in').default,
  '(auth)/verify': require('../(auth)/verify').default,
  '(app)/_layout': require('../(app)/_layout').default,
  '(app)/home': require('../(app)/home').default,
  '(app)/chat/[id]': require('../(app)/chat/[id]').default,
  '(app)/voice': require('../(app)/voice').default,
  '(app)/settings/index': require('../(app)/settings/index').default,
  '(app)/settings/models': require('../(app)/settings/models').default,
  '(app)/customizations': require('../(app)/customizations').default,
  '(app)/remote/index': require('../(app)/remote/index').default,
  '(app)/remote/[deviceId]': require('../(app)/remote/[deviceId]').default,
  '(app)/project/new': require('../(app)/project/new').default,
  '(app)/project/[id]': require('../(app)/project/[id]').default,
};

const signIn = () =>
  act(async () => {
    useAuth.setState({
      ready: true,
      session: { access_token: 't', user: { id: 'u1', email: 'me@example.com' } } as never,
      user: { id: 'u1', email: 'me@example.com' } as never,
    });
  });

beforeEach(async () => {
  await act(async () => {
    useAuth.setState({ ready: true, session: null, user: null });
    useChat.setState({ projects: [], conversations: [] });
  });
});

describe('signed out', () => {
  it('opens the sign-in screen with backend setup (no backend is configured in tests)', async () => {
    await renderRouter(files, { initialUrl: '/' });
    expect(await screen.findByText('Remo Code')).toBeTruthy();
    expect(screen.getByText('Connect your Supabase project')).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });
});

describe('signed in', () => {
  const open = async (url: string) => {
    await signIn();
    await renderRouter(files, { initialUrl: url });
  };

  it.each([
    ['/', 'Customizations'],
    ['/home', 'Remote Control'],
    ['/settings', 'Account'],
    ['/settings/models', 'Cloud (bring your own key)'],
    ['/customizations', 'Connectors'],
    ['/project/new', 'Create project'],
    ['/remote', 'Your computers'],
  ])('%s renders', async (url, text) => {
    await open(url);
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });

  it('the voice screen renders (classic voice, since no Gemini key is set)', async () => {
    await open('/voice');
    expect(await screen.findByText('Tap to talk')).toBeTruthy();
  });

  it('a chat screen renders for a real conversation and for a missing one', async () => {
    await signIn();
    let id = '';
    await act(async () => {
      id = useChat.getState().createConversation(null).id;
    });
    await renderRouter(files, { initialUrl: `/chat/${id}` });
    expect(await screen.findByText('Ask anything')).toBeTruthy();
  });

  it('a project screen renders with and without resources, and the add-resource sheet opens', async () => {
    await signIn();
    let id = '';
    await act(async () => {
      const p = useChat.getState().createProject('Grid', 'be brief');
      useChat.getState().addResource(p.id, { kind: 'file', name: 'notes.md', content: 'hello', source: 'upload' });
      useChat.getState().addResource(p.id, { kind: 'drive-folder', folderId: 'folderAAAAAAAAAA', name: 'Specs' });
      id = p.id;
    });
    await renderRouter(files, { initialUrl: `/project/${id}` });
    expect(await screen.findByText('notes.md')).toBeTruthy();
    expect(screen.getByText('Specs')).toBeTruthy();
    expect(screen.getByText('Add resource')).toBeTruthy();
  });

  it('settings render with connectors connected', async () => {
    await act(async () => {
      useConnectors.setState({ github: { connected: true, login: 'octo' }, google: { connected: true } });
      useSettings.setState({ hasKey: { gemini: true } });
    });
    await open('/customizations');
    expect(await screen.findByText('Connected as octo')).toBeTruthy();
  });
});
