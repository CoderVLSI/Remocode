import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuth } from '@/store/auth';
import { BackendProvider } from '@/ui/BackendProvider';
import { BrandSplash } from '@/ui/BrandSplash';
import { RootNavigator } from '@/ui/RootNavigator';

// Keep the splash up until the stored session has been read, so signed-in users never see the sign-in screen flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate() {
  const signedIn = useAuth((s) => s.signedIn);
  const ready = useAuth((s) => s.ready);
  const [minTimePassed, setMinTimePassed] = useState(false);

  useEffect(() => {
    // Show the brand splash long enough to read, even when the stored session loads instantly.
    const t = setTimeout(() => setMinTimePassed(true), 1100);
    // Safety net: never leave the system splash up if the brand image fails to report.
    const fallback = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 2500);
    return () => {
      clearTimeout(t);
      clearTimeout(fallback);
    };
  }, []);

  if (!ready || !minTimePassed) {
    return <BrandSplash onShown={() => SplashScreen.hideAsync().catch(() => {})} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator signedIn={signedIn} />
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <BackendProvider>
      <Gate />
    </BackendProvider>
  );
}
