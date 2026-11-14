import { Stack } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { create } from 'zustand';

import { RootIndex, RootNavigator } from '../RootNavigator';

/** A stand-in for the auth store, so we can sign in and out inside the test. */
const useSession = create<{ signedIn: boolean }>(() => ({ signedIn: false }));

function Root() {
  const signedIn = useSession((s) => s.signedIn);
  return <RootNavigator signedIn={signedIn} />;
}
function Index() {
  const signedIn = useSession((s) => s.signedIn);
  return <RootIndex signedIn={signedIn} />;
}
function Group() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
function screenText(id: string) {
  const Screen = () => <Text testID={id}>{id}</Text>;
  Screen.displayName = `Screen(${id})`;
  return Screen;
}

// Same shape as src/app: a root index plus an (auth) group and an (app) group.
const files = {
  _layout: Root,
  index: Index,
  '(auth)/_layout': Group,
  '(auth)/sign-in': screenText('sign-in'),
  '(auth)/verify': screenText('verify'),
  '(app)/_layout': Group,
  '(app)/home': screenText('home'),
  '(app)/settings': screenText('settings'),
};

const signInAs = (signedIn: boolean) => act(async () => useSession.setState({ signedIn }));

describe('launch routing (the app opens at "/")', () => {
  beforeEach(async () => {
    await signInAs(false);
  });

  it('signed out: opens the sign-in screen, not "Unmatched Route"', async () => {
    await renderRouter(files, { initialUrl: '/' });
    expect(await screen.findByTestId('sign-in')).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
    expect(screen).toHavePathname('/sign-in');
  });

  it('signed in: opens home', async () => {
    await signInAs(true);
    await renderRouter(files, { initialUrl: '/' });
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(screen).toHavePathname('/home');
  });

  it('signing in moves from sign-in to home', async () => {
    await renderRouter(files, { initialUrl: '/' });
    expect(await screen.findByTestId('sign-in')).toBeTruthy();
    await signInAs(true);
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(screen.queryByTestId('sign-in')).toBeNull();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });

  it('signing out moves from home back to sign-in', async () => {
    await signInAs(true);
    await renderRouter(files, { initialUrl: '/' });
    expect(await screen.findByTestId('home')).toBeTruthy();
    await signInAs(false);
    expect(await screen.findByTestId('sign-in')).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });

  it('a link to a signed-in screen while signed out lands on sign-in', async () => {
    await renderRouter(files, { initialUrl: '/settings' });
    expect(await screen.findByTestId('sign-in')).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });

  it('a link to sign-in while already signed in lands on home', async () => {
    await signInAs(true);
    await renderRouter(files, { initialUrl: '/sign-in' });
    expect(await screen.findByTestId('home')).toBeTruthy();
    expect(screen.queryByText('Unmatched Route')).toBeNull();
  });
});
