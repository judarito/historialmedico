import { useEffect } from 'react';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { router } from 'expo-router';
import { markBootStep } from '../services/runtimeDiagnostics';

export default function Index() {
  useEffect(() => {
    void markBootStep('IndexRoute:welcome_screen');
  }, []);

  return (
    <WelcomeScreen
      onLogin={()    => router.push('/login')}
      onRegister={() => router.push('/register')}
    />
  );
}
