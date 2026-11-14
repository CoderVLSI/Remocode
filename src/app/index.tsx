import { useAuth } from '@/store/auth';
import { RootIndex } from '@/ui/RootNavigator';

export default function Index() {
  const signedIn = useAuth((s) => s.signedIn);
  return <RootIndex signedIn={signedIn} />;
}
