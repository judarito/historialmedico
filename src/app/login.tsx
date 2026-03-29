import { router } from 'expo-router';
import { Alert } from 'react-native';
import { LoginScreen } from '../screens/LoginScreen';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';

export default function LoginRoute() {
  const { signIn, loading } = useAuthStore();
  const { fetchTenantAndFamily } = useFamilyStore();

  async function handleLogin(email: string, password: string) {
    const error = await signIn(email, password);
    if (error) {
      Alert.alert('Error al iniciar sesión', error);
      return;
    }
    // Verificar si tiene tenant configurado
    await fetchTenantAndFamily();
    const { tenant } = useFamilyStore.getState();
    if (!tenant) {
      router.replace('/onboarding');
    } else {
      router.replace('/(app)/(tabs)');
    }
  }

  return (
    <LoginScreen
      onLogin={handleLogin}
      onGoRegister={() => router.push('/register')}
      onGoBack={() => router.back()}
      loading={loading}
    />
  );
}
