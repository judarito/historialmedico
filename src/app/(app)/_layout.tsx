import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { useNotificationStore } from '../../store/notificationStore';
import { Colors } from '../../theme';
import { captureException, markBootStep } from '../../services/runtimeDiagnostics';
import { NotificationService } from '../../services/notifications';

export default function AppLayout() {
  const { session, initialized } = useAuthStore();
  const { tenant, fetchTenantAndFamily } = useFamilyStore();
  const initializeNotifications = useNotificationStore((state) => state.initialize);
  const resetNotifications = useNotificationStore((state) => state.reset);

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
  }, [fetchTenantAndFamily, initialized, session]);

  useEffect(() => {
    if (!session?.user?.id || !tenant?.id) {
      resetNotifications();
      return;
    }

    void initializeNotifications(tenant.id, session.user.id);
  }, [initializeNotifications, resetNotifications, session?.user?.id, tenant?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;

    return NotificationService.subscribeToNotificationOpens((route) => {
      router.push(route as never);
    });
  }, [session?.user?.id]);

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
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
