import { router } from 'expo-router';
import { Alert } from 'react-native';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { useAuthStore } from '../store/authStore';
import { PASSWORD_RESET_REDIRECT_URL } from '../services/authLinks';

export default function ForgotPasswordRoute() {
  const { requestPasswordReset, loading } = useAuthStore();

  async function handleSubmit(email: string) {
    const error = await requestPasswordReset(email);
    if (error) {
      Alert.alert('No pudimos enviar el enlace', error);
      return;
    }

    Alert.alert(
      'Correo enviado',
      `Te enviamos un enlace de recuperación a ${email}. Si el link no abre la app, asegúrate de permitir el redirect ${PASSWORD_RESET_REDIRECT_URL} en Supabase Auth.`,
      [{ text: 'Volver al login', onPress: () => router.replace('/login') }]
    );
  }

  return (
    <ForgotPasswordScreen
      onSubmit={handleSubmit}
      onGoBack={() => router.back()}
      loading={loading}
    />
  );
}
