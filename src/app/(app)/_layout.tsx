import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { Colors } from '../../theme';

export default function AppLayout() {
  const { session, initialized } = useAuthStore();
  const { fetchTenantAndFamily } = useFamilyStore();

  useEffect(() => {
    if (!initialized) return;
    if (!session) { router.replace('/login'); return; }
    fetchTenantAndFamily();
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
