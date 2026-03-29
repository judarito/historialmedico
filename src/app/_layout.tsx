import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { NotificationService } from '../services/notifications';
import { Colors } from '../theme';

export default function RootLayout() {
  const { init, initialized, session } = useAuthStore();

  useEffect(() => { init(); }, []);

  useEffect(() => {
    if (session) {
      NotificationService.registerForPushNotifications().catch(() => {});
    }
  }, [session?.user?.id]);

  if (!initialized) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
          <StatusBar style="light" backgroundColor={Colors.background} />
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={Colors.background} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(app)" />
      </Stack>
    </SafeAreaProvider>
  );
}
