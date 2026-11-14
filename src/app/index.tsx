import { useAuth } from '@/store/auth';
import { RootIndex } from '@/ui/RootNavigator';

export default function Index() {
  const signedIn = useAuth((s) => !!s.session);
  return <RootIndex signedIn={signedIn} />;
}
