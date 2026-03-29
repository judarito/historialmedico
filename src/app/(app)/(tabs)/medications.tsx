import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFamilyStore } from '../../../store/familyStore';
import { useMedicationStore } from '../../../store/medicationStore';
import { Colors, Typography, Spacing, Radius } from '../../../theme';
import type { Database } from '../../../types/database.types';

type ScheduleStatus = Database['public']['Tables']['medication_schedules']['Row']['status'];

export default function MedicationsTab() {
  const { members, fetchMembers } = useFamilyStore();
  const { doses, loading, marking, fetchTodayDoses, markDose } = useMedicationStore();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers().then(() => {
      const { members: ms } = useFamilyStore.getState();
      if (ms.length > 0) {
        setSelectedMember(ms[0].id);
        fetchTodayDoses(ms[0].id);
      }
    });
  }, []);

  function selectMember(id: string) {
    setSelectedMember(id);
    fetchTodayDoses(id);
  }

  async function handleMark(scheduleId: string, status: ScheduleStatus) {
    const err = await markDose(scheduleId, status);
    if (err) Alert.alert('Error', err);
  }

  const pending = doses.filter(d => d.status === 'pending' || d.status === 'late');
  const done    = doses.filter(d => d.status === 'taken' || d.status === 'skipped');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Medicamentos</Text>
        <Text style={styles.subtitle}>Dosis de hoy</Text>
      </View>

      {/* Selector de miembro */}
      {members.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberTabs}>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberTab, selectedMember === m.id && styles.memberTabActive]}
              onPress={() => selectMember(m.id)}
            >
              <Text style={[styles.memberTabText, selectedMember === m.id && styles.memberTabTextActive]}>
                {m.first_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading
        ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        : (
          <ScrollView contentContainerStyle={styles.list}>
            {doses.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="checkmark-circle-outline" size={56} color={Colors.healthy} />
                <Text style={styles.emptyTitle}>Sin dosis pendientes</Text>
                <Text style={styles.emptyText}>No hay medicamentos programados para hoy.</Text>
              </View>
            )}

            {pending.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Pendientes</Text>
                {pending.map(d => (
                  <DoseCard
                    key={d.schedule_id}
                    dose={d}
                    marking={marking === d.schedule_id}
                    onTaken={() => handleMark(d.schedule_id, 'taken')}
                    onSkipped={() => handleMark(d.schedule_id, 'skipped')}
                  />
                ))}
              </>
            )}

            {done.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: Spacing.base }]}>Completadas</Text>
                {done.map(d => (
                  <DoseCard key={d.schedule_id} dose={d} marking={false} done />
                ))}
              </>
            )}
          </ScrollView>
        )
      }
    </SafeAreaView>
  );
}

function DoseCard({ dose, marking, done, onTaken, onSkipped }: {
  dose: any; marking: boolean; done?: boolean;
  onTaken?: () => void; onSkipped?: () => void;
}) {
  const isTaken   = dose.status === 'taken';
  const isSkipped = dose.status === 'skipped';
  const isLate    = dose.status === 'late';

  const time = new Date(dose.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={[styles.doseCard, isLate && styles.doseCardLate, done && styles.doseCardDone]}>
      <View style={styles.doseLeft}>
        <View style={[styles.dotIndicator, isTaken && { backgroundColor: Colors.healthy }, isSkipped && { backgroundColor: Colors.textMuted }, isLate && { backgroundColor: Colors.alert }]} />
        <View style={styles.doseInfo}>
          <Text style={styles.doseName}>{dose.medication_name}</Text>
          <Text style={styles.doseMeta}>{dose.dose_label ?? `${dose.dose_amount} ${dose.dose_unit}`} · {time}</Text>
          {dose.route && <Text style={styles.doseRoute}>{dose.route}</Text>}
        </View>
      </View>

      {!done && (
        <View style={styles.doseActions}>
          {marking
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : (
              <>
                <TouchableOpacity style={styles.actionBtn} onPress={onTaken}>
                  <Ionicons name="checkmark" size={18} color={Colors.healthy} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtnSkip} onPress={onSkipped}>
                  <Ionicons name="close" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              </>
            )
          }
        </View>
      )}

      {done && (
        <Ionicons
          name={isTaken ? 'checkmark-circle' : 'close-circle'}
          size={22}
          color={isTaken ? Colors.healthy : Colors.textMuted}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.base, paddingTop: Spacing.base, paddingBottom: Spacing.sm },
  title: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.sm },
  memberTabs: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm, gap: Spacing.sm },
  memberTab: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  memberTabActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  memberTabText: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  memberTabTextActive: { color: Colors.primary },
  list: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  sectionLabel: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.semibold, marginBottom: 4 },
  empty: { alignItems: 'center', marginTop: 80, gap: Spacing.md },
  emptyTitle: { color: Colors.healthy, fontSize: Typography.lg, fontWeight: Typography.bold },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base, textAlign: 'center' },

  doseCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  doseCardLate: { borderColor: Colors.alert + '66', backgroundColor: Colors.alertBg },
  doseCardDone: { opacity: 0.65 },
  doseLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  dotIndicator: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.warning },
  doseInfo: { flex: 1, gap: 3 },
  doseName: { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.semibold },
  doseMeta: { color: Colors.textSecondary, fontSize: Typography.sm },
  doseRoute: { color: Colors.textMuted, fontSize: Typography.xs },
  doseActions: { flexDirection: 'row', gap: Spacing.xs },
  actionBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.healthy + '22', alignItems: 'center', justifyContent: 'center',
  },
  actionBtnSkip: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
