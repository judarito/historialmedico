import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { DashboardScreen } from '../../../screens/DashboardScreen';
import { supabase } from '../../../services/supabase';
import { captureException } from '../../../services/runtimeDiagnostics';
import { useAuthStore } from '../../../store/authStore';
import { useFamilyStore } from '../../../store/familyStore';
import { useNotificationStore } from '../../../store/notificationStore';

export default function DashboardTab() {
  const { user } = useAuthStore();
  const {
    tenant,
    members,
    fetchTenantAndFamily,
    fetchMembers,
  } = useFamilyStore();
  const unreadNotifications = useNotificationStore((state) => state.unreadCount);
  const refreshNotifications = useNotificationStore((state) => state.refresh);

  const [appointmentsCount, setAppointmentsCount] = useState(0);
  const [activeMedicationsCount, setActiveMedicationsCount] = useState(0);
  const [directoryFavoritesCount, setDirectoryFavoritesCount] = useState(0);

  const refreshDashboardMetrics = useCallback(async () => {
    try {
      const activeTenant = useFamilyStore.getState().tenant;
      if (!activeTenant?.id) {
        setAppointmentsCount(0);
        setActiveMedicationsCount(0);
        setDirectoryFavoritesCount(0);
        return;
      }

      const nowIso = new Date().toISOString();
      const [appointmentsRes, medicationsRes, favoritesRes] = await Promise.all([
        supabase
          .from('medical_visits')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', activeTenant.id)
          .eq('status', 'scheduled')
          .is('deleted_at', null)
          .gt('visit_date', nowIso),
        supabase
          .from('prescriptions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', activeTenant.id)
          .eq('status', 'active'),
        user?.id
          ? supabase
              .from('medical_directory_favorites')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
          : Promise.resolve({ count: 0, error: null } as const),
      ]);

      setAppointmentsCount(appointmentsRes.count ?? 0);
      setActiveMedicationsCount(medicationsRes.count ?? 0);
      setDirectoryFavoritesCount(favoritesRes.count ?? 0);
    } catch (error) {
      await captureException('DashboardTab.refreshDashboardMetrics', error);
      setAppointmentsCount(0);
      setActiveMedicationsCount(0);
      setDirectoryFavoritesCount(0);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchTenantAndFamily()
      .then(async () => {
        const state = useFamilyStore.getState();
        if (!state.tenant || !state.family) {
          router.replace('/onboarding');
          return;
        }

        await state.fetchMembers();
        const nextMembers = useFamilyStore.getState().members;
        if (nextMembers.length === 0) {
          router.replace('/onboarding/member');
          return;
        }

        await refreshDashboardMetrics();
      })
      .catch(async (error) => {
        await captureException('DashboardTab.bootstrap', error);
      });
  }, [fetchTenantAndFamily, refreshDashboardMetrics]);

  useFocusEffect(useCallback(() => {
    void refreshDashboardMetrics();
    void refreshNotifications();
  }, [refreshDashboardMetrics, refreshNotifications, tenant?.id]));

  const firstName = user?.user_metadata?.full_name?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? 'Usuario';

  const dashMembers = members.map((member) => ({
    id:         member.id,
    name:       member.first_name,
    statusText: member.eps_name ?? 'Sin EPS registrada',
    status:     'neutral' as const,
    avatarUrl:  member.avatar_url ?? null,
  }));

  return (
    <DashboardScreen
      userName={firstName}
      avatarUrl={user?.user_metadata?.avatar_url ?? null}
      appointments={appointmentsCount}
      reminders={unreadNotifications}
      steps={activeMedicationsCount}
      directoryFavorites={directoryFavoritesCount}
      criticalAlerts={0}
      members={dashMembers}
      onMemberPress={(id) => router.push(`/(app)/member/${id}`)}
      onNotifications={() => router.push('/(app)/notifications')}
      onSearch={() => router.push('/(app)/search')}
      onMedicalDirectory={() => router.push({ pathname: '/(app)/doctor-directory', params: { favorites: '1' } })}
      onQuickSchedule={() => router.push({ pathname: '/(app)/add-visit', params: { mode: 'schedule', defaultFuture: '1' } })}
      onAppointmentsCalendar={() => router.push('/(app)/appointments')}
    />
  );
}
