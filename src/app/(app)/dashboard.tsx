import { DashboardScreen } from '../../screens/DashboardScreen';
import { useAuthStore } from '../../store/authStore';
import { router } from 'expo-router';

// Datos mock mientras se conecta Supabase
const MOCK_MEMBERS = [
  { id: '1', name: 'Andrea',   statusText: 'Cita hoy 3pm',   status: 'warning'  as const },
  { id: '2', name: 'Santiago', statusText: 'Medicamento 5pm', status: 'alert'   as const },
  { id: '3', name: 'Lucía',    statusText: 'Todo bien',       status: 'healthy'  as const },
];

export default function DashboardRoute() {
  const { user, signOut } = useAuthStore();

  const firstName = user?.user_metadata?.full_name?.split(' ')[0]
    ?? user?.email?.split('@')[0]
    ?? 'Usuario';

  async function handleSignOut() {
    await signOut();
    router.replace('/');
  }

  return (
    <DashboardScreen
      userName={firstName}
      avatarUrl={null}
      appointments={3}
      reminders={2}
      steps={5}
      criticalAlerts={1}
      members={MOCK_MEMBERS}
      onMemberPress={(id) => console.log('member', id)}
      onNotifications={handleSignOut}
    />
  );
}
