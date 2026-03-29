import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../store/authStore';
import { useFamilyStore } from '../../../store/familyStore';
import { Avatar } from '../../../components/ui/Avatar';
import { Colors, Typography, Spacing, Radius } from '../../../theme';

export default function ProfileTab() {
  const { user, signOut } = useAuthStore();
  const { tenant, members, reset } = useFamilyStore();

  const fullName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'Usuario';
  const email    = user?.email ?? '';

  async function handleSignOut() {
    Alert.alert('Cerrar sesión', '¿Estás seguro de que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir', style: 'destructive',
        onPress: async () => {
          await signOut();
          reset();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar + nombre */}
        <View style={styles.profileCard}>
          <Avatar name={fullName} imageUrl={null} size={72} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
        </View>

        {/* Familia */}
        {tenant && (
          <Section title="Grupo familiar">
            <InfoRow icon="home-outline" label="Nombre" value={tenant.name} />
            <InfoRow icon="people-outline" label="Miembros" value={`${members.length} registrados`} />
          </Section>
        )}

        {/* Opciones */}
        <Section title="Configuración">
          <OptionRow icon="notifications-outline" label="Notificaciones" onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')} />
          <OptionRow icon="shield-outline" label="Privacidad y datos" onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')} />
          <OptionRow icon="help-circle-outline" label="Ayuda" onPress={() => Alert.alert('Próximamente', 'Esta función estará disponible pronto.')} />
        </Section>

        {/* Cerrar sesión */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={20} color={Colors.alert} />
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Family Health Tracker IA v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function OptionRow({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={18} color={Colors.textSecondary} />
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.base, paddingTop: Spacing.base, paddingBottom: Spacing.xxxl, gap: Spacing.xl },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.base,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  profileInfo: { flex: 1, gap: 4 },
  profileName: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  profileEmail: { color: Colors.textSecondary, fontSize: Typography.sm },

  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rowLabel: { color: Colors.textSecondary, fontSize: Typography.base },
  rowValue: { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.medium, marginLeft: 'auto' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 52, backgroundColor: Colors.alertBg, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.alert + '44',
  },
  signOutText: { color: Colors.alert, fontSize: Typography.md, fontWeight: Typography.semibold },
  version: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center' },
});
