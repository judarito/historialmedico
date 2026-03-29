import { useEffect } from 'react';
import { router } from 'expo-router';
import { DashboardScreen } from '../../../screens/DashboardScreen';
import { useAuthStore } from '../../../store/authStore';
import { useFamilyStore } from '../../../store/familyStore';

export default function DashboardTab() {
  const { user } = useAuthStore();
  const { tenant, members, fetchTenantAndFamily, fetchMembers, loading } = useFamilyStore();

  useEffect(() => {
    fetchTenantAndFamily().then(() => {
      const { tenant: t } = useFamilyStore.getState();
      if (!t) { router.replace('/onboarding'); return; }
      fetchMembers();
    });
  }, []);

  const firstName = user?.user_metadata?.full_name?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? 'Usuario';

  // Derivar status de cada miembro (simplificado — se puede enriquecer con dosis)
  const dashMembers = members.map(m => ({
    id:         m.id,
    name:       m.first_name,
    statusText: m.eps_name ?? 'Sin EPS registrada',
    status:     'neutral' as const,
    avatarUrl:  m.avatar_url ?? null,
  }));

  return (
    <DashboardScreen
      userName={firstName}
      avatarUrl={user?.user_metadata?.avatar_url ?? null}
      appointments={0}
      reminders={0}
      steps={members.length}
      criticalAlerts={0}
      members={dashMembers}
      onMemberPress={(id) => router.push(`/(app)/member/${id}`)}
      onNotifications={() => router.push('/(app)/(tabs)/profile')}
      onSearch={() => router.push('/(app)/search')}
    />
  );
}
