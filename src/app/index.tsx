import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { router } from 'expo-router';
import { markBootStep } from '../services/runtimeDiagnostics';
import { useAuthStore } from '../store/authStore';
import { resolveAuthenticatedRoute } from '../utils/authRouting';
import { Colors } from '../theme';

export default function Index() {
  const { initialized, session } = useAuthStore();
  const [resolvingRoute, setResolvingRoute] = useState(true);

  useEffect(() => {
    let active = true;

    async function resolveRoute() {
      if (!initialized) return;

      if (!session) {
        await markBootStep('IndexRoute:welcome_screen');
        if (active) setResolvingRoute(false);
        return;
      }

      if (active) setResolvingRoute(true);
      await markBootStep('IndexRoute:resolve_authenticated_route');
      const destination = await resolveAuthenticatedRoute();
      if (!active) return;
      router.replace(destination);
    }

    void resolveRoute();

    return () => {
      active = false;
    };
  }, [initialized, session?.user?.id]);

  if (!initialized || resolvingRoute) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <WelcomeScreen
      onLogin={()    => router.push('/login')}
      onRegister={() => router.push('/register')}
    />
  );
}
