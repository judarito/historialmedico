import { router } from 'expo-router';
import { Alert } from 'react-native';
import { LoginScreen } from '../screens/LoginScreen';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { resolveAuthenticatedRoute } from '../utils/authRouting';

export default function LoginRoute() {
  const { signIn, loading } = useAuthStore();

  async function handleLogin(email: string, password: string) {
    const error = await signIn(email, password);
    if (error) {
      Alert.alert('Error al iniciar sesión', error);
      return;
    }

    const destination = await resolveAuthenticatedRoute();
    const notice = useFamilyStore.getState().consumeInviteClaimNotice();

    if (notice) {
      Alert.alert('Invitación pendiente', notice, [
        { text: 'Entendido', onPress: () => router.replace(destination) },
      ]);
      return;
    }

    router.replace(destination);
  }

  return (
    <LoginScreen
      onLogin={handleLogin}
      onGoForgotPassword={() => router.push('/forgot-password')}
      onGoRegister={() => router.push('/register')}
      onGoBack={() => router.back()}
      loading={loading}
    />
  );
}
