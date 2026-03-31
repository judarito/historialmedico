import { router } from 'expo-router';
import { Alert } from 'react-native';
import { UpdatePasswordScreen } from '../screens/UpdatePasswordScreen';
import { useAuthStore } from '../store/authStore';
import { resolveAuthenticatedRoute } from '../utils/authRouting';

export default function ResetPasswordRoute() {
  const { session, updatePassword, loading } = useAuthStore();

  async function handleSubmit(password: string) {
    const error = await updatePassword(password);
    if (error) {
      Alert.alert('No pudimos actualizar la contraseña', error);
      return;
    }

    const destination = await resolveAuthenticatedRoute();
    Alert.alert('Contraseña actualizada', 'Ya puedes seguir usando tu cuenta con la nueva contraseña.', [
      { text: 'Continuar', onPress: () => router.replace(destination) },
    ]);
  }

  return (
    <UpdatePasswordScreen
      onSubmit={handleSubmit}
      onGoBack={() => router.replace('/login')}
      loading={loading}
      canEdit={Boolean(session)}
    />
  );
}
