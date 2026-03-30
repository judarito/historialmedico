import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { Colors } from '../../theme';
import { captureException, markBootStep } from '../../services/runtimeDiagnostics';

export default function AppLayout() {
  const { session, initialized } = useAuthStore();
  const { fetchTenantAndFamily } = useFamilyStore();

  useEffect(() => {
    async function prepareApp() {
      if (!initialized) return;
      if (!session) {
        await markBootStep('appLayout:noSession');
        router.replace('/login');
        return;
      }

      try {
        await markBootStep('appLayout:fetchTenantAndFamily:start');
        await fetchTenantAndFamily();
        await markBootStep('appLayout:fetchTenantAndFamily:done');
      } catch (error) {
        await captureException('AppLayout.prepareApp', error);
      }
    }

    void prepareApp();
  }, [session, initialized]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="member/[id]" />
      <Stack.Screen name="confirm-scan" />
      <Stack.Screen name="add-visit" />
      <Stack.Screen name="history" />
      <Stack.Screen name="edit-member" />
      <Stack.Screen name="visit/[id]" />
      <Stack.Screen name="search" />
    </Stack>
  );
}
