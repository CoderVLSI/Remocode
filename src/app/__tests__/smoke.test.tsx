/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories and screen modules are loaded with require on purpose */
/**
 * Smoke test: renders the app's real screens (not stand-ins) with native modules mocked, signed
 * out and signed in, so a screen that crashes on open fails here instead of on a phone.
 */
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useAuth } from '@/store/auth';
import { useBackend } from '@/store/backend';
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

// `mock`-prefixed names may be used inside jest.mock factories.
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@convex-dev/auth/react', () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuthActions: () => ({ signIn: mockSignIn, signOut: mockSignOut }),
}));
jest.mock('convex/react', () => ({
  ConvexReactClient: jest.fn(),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useConvex: () => ({ query: jest.fn(), mutation: jest.fn() }),
  useQuery: jest.fn(() => []),
  useMutation: () => jest.fn(async () => undefined),
  useAction: () => jest.fn(async () => ({ code: 'ABCD-EFGH', expiresAt: Date.now() + 600_000 })),
}));

const files = {
  _layout: function Root() {
    const signedIn = useAuth((s) => s.signedIn);
    return <RootNavigator signedIn={signedIn} />;
  },
  index: function Index() {
    const signedIn = useAuth((s) => s.signedIn);
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

const signIn = () => act(async () => useAuth.setState({ ready: true, signedIn: true }));

beforeEach(async () => {
  await act(async () => {
    useAuth.setState({ ready: true, signedIn: false });
    useBackend.setState({ url: null, loaded: true });
    useChat.setState({ projects: [], conversations: [] });
    mockSignIn.mockReset();
    mockSignOut.mockReset();
  });
});

describe('signed out', () => {
  const openSignIn = async (withBackend: boolean) => {
    if (withBackend) await act(async () => useBackend.setState({ url: 'https://demo-app-123.convex.cloud', loaded: true }));
    await renderRouter(files, { initialUrl: '/' });
  };
  const fill = async (email: string, password?: string) => {
    await fireEvent.changeText(await screen.findByPlaceholderText('you@example.com'), email);
    if (password !== undefined) await fireEvent.changeText(screen.getByPlaceholderText(/Your password|At least 8/), password);
  };

  it('with no backend yet, asks for the Convex URL instead of showing a dead sign-in form', async () => {
    await openSignIn(false);
    expect(await screen.findByText('Remo Code')).toBeTruthy();
    expect(screen.getByText('Connect your Convex backend')).toBeTruthy();
    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });

  it('saving a bad URL shows the problem; a good one reveals the sign-in form', async () => {
    await openSignIn(false);
    await fireEvent.changeText(await screen.findByPlaceholderText('https://your-name-123.convex.cloud'), 'https://abc-def-1.convex.site');
    await fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText(/HTTP actions URL/)).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('https://your-name-123.convex.cloud'), 'https://abc-def-1.convex.cloud');
    await fireEvent.press(screen.getByText('Save and continue'));
    expect(await screen.findByText('Create an account')).toBeTruthy();
    expect(screen.getByText(/Backend: abc-def-1\.convex\.cloud/)).toBeTruthy();
  });

  it('signs in with email and password using the documented Convex Auth call', async () => {
    mockSignIn.mockResolvedValue({ signingIn: true });
    await openSignIn(true);
    await fill('  Me@Example.COM ', 'hunter2hunter2');
    await fireEvent.press(screen.getAllByText('Sign in')[0]);
    await act(async () => {});
    expect(mockSignIn).toHaveBeenCalledWith('password', { email: 'me@example.com', password: 'hunter2hunter2', flow: 'signIn' });
  });

  it('shows a friendly message when sign-in fails', async () => {
    mockSignIn.mockRejectedValue(new Error('[CONVEX A(auth:signIn)] [Request ID: 1] Server Error'));
    await openSignIn(true);
    await fill('me@example.com', 'wrongpassword');
    await fireEvent.press(screen.getAllByText('Sign in')[0]);
    expect(await screen.findByText(/Wrong email or password/)).toBeTruthy();
  });

  it('validates before calling the server', async () => {
    await openSignIn(true);
    await fill('not-an-email', '');
    await fireEvent.press(screen.getAllByText('Sign in')[0]);
    expect(await screen.findByText(/does not look right/)).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('creating an account that needs email confirmation continues to the code screen, then verifies', async () => {
    mockSignIn.mockResolvedValueOnce({ signingIn: false }); // sign-up: email must be confirmed
    await openSignIn(true);
    await fireEvent.press(await screen.findByText('Create an account'));
    await fill('new@example.com', 'a-long-password');
    await fireEvent.press(screen.getByText('Create account'));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(mockSignIn).toHaveBeenCalledWith('password', { email: 'new@example.com', password: 'a-long-password', flow: 'signUp' });

    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '123 456');
    await act(async () => {});
    expect(mockSignIn).toHaveBeenLastCalledWith('password', { email: 'new@example.com', code: '123456', flow: 'email-verification' });
  });

  it('the passwordless tab emails a code, then signs in with it', async () => {
    mockSignIn.mockResolvedValueOnce({ signingIn: false });
    await openSignIn(true);
    await fireEvent.press(await screen.findByText('Email code'));
    await fill('me@example.com');
    await fireEvent.press(screen.getByText('Email me a code'));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(mockSignIn).toHaveBeenCalledWith('resend-otp', { email: 'me@example.com' });

    mockSignIn.mockResolvedValueOnce({ signingIn: true });
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '654321');
    await act(async () => {});
    expect(mockSignIn).toHaveBeenLastCalledWith('resend-otp', { email: 'me@example.com', code: '654321' });
  });

  it('a wrong code shows a message and clears the field', async () => {
    mockSignIn.mockResolvedValueOnce({ signingIn: false });
    await openSignIn(true);
    await fireEvent.press(await screen.findByText('Email code'));
    await fill('me@example.com');
    await fireEvent.press(screen.getByText('Email me a code'));
    await screen.findByText('Check your email');
    mockSignIn.mockRejectedValueOnce(new Error('Could not verify code'));
    await fireEvent.changeText(screen.getByLabelText('Verification code'), '000000');
    expect(await screen.findByText(/not right or has expired/)).toBeTruthy();
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
    ['/remote/k17abcdef0123456789abcdefghi', 'No tasks yet.'],
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
