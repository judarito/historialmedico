import { router } from 'expo-router';
import { Alert } from 'react-native';
import { RegisterScreen } from '../screens/RegisterScreen';
import { useAuthStore } from '../store/authStore';

export default function RegisterRoute() {
  const { signUp, loading } = useAuthStore();

  async function handleRegister(email: string, password: string, fullName: string) {
    const error = await signUp(email, password, fullName);
    if (error) {
      Alert.alert('Error al registrarse', error);
    } else {
      Alert.alert(
        'Cuenta creada',
        'Revisa tu correo para confirmar tu cuenta y luego inicia sesión. Si tenías una invitación pendiente con ese correo, se activará automáticamente al entrar.',
        [{ text: 'Ir al login', onPress: () => router.replace('/login') }]
      );
    }
  }

  return (
    <RegisterScreen
      onRegister={handleRegister}
      onGoLogin={() => router.replace('/login')}
      onGoBack={() => router.back()}
      loading={loading}
    />
  );
}
