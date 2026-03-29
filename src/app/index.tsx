import { WelcomeScreen } from '../screens/WelcomeScreen';
import { router } from 'expo-router';

export default function Index() {
  return (
    <WelcomeScreen
      onLogin={()    => router.push('/login')}
      onRegister={() => router.push('/register')}
    />
  );
}
