import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useFamilyStore } from '../../../store/familyStore';
import { useMedicationStore } from '../../../store/medicationStore';
import { supabase } from '../../../services/supabase';
import { Colors, Typography, Spacing, Radius } from '../../../theme';
import type { Database } from '../../../types/database.types';

type ScheduleStatus = Database['public']['Tables']['medication_schedules']['Row']['status'];

function getMemberDisplayName(member: Database['public']['Tables']['family_members']['Row']): string {
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
}

export default function MedicationsTab() {
  const params = useLocalSearchParams<{ memberId?: string | string[] }>();
  const routeMemberId = Array.isArray(params.memberId)
    ? (params.memberId[0] ?? null)
    : (params.memberId ?? null);
  const { family, members, fetchMembers } = useFamilyStore();
  const { doses, loading, marking, fetchTodayDoses, markDose } = useMedicationStore();
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const selectedMemberRef = useRef<string | null>(null);
  const inFlightMemberLoadRef = useRef<string | null>(null);
  const lastMemberLoadRef = useRef<{ memberId: string | null; at: number }>({ memberId: null, at: 0 });
  const lastFocusRefreshRef = useRef<{ memberId: string | null; at: number }>({ memberId: null, at: 0 });
  const [expiringMeds, setExpiringMeds] = useState<{ medication_name: string; end_at: string }[]>([]);

  useEffect(() => {
    selectedMemberRef.current = selectedMember;
  }, [selectedMember]);

  const ensureMembersLoaded = useCallback(async (forceRefresh = false) => {
    let currentMembers = useFamilyStore.getState().members;
    if (family?.id && (forceRefresh || currentMembers.length === 0)) {
      await fetchMembers();
      currentMembers = useFamilyStore.getState().members;
    }
    return currentMembers;
  }, [family?.id, fetchMembers]);

  const loadMemberData = useCallback(async (memberIdToLoad: string, options?: { force?: boolean }) => {
    const now = Date.now();
    const lastLoad = lastMemberLoadRef.current;

    if (inFlightMemberLoadRef.current === memberIdToLoad) {
      return;
    }

    if (
      !options?.force
      && lastLoad.memberId === memberIdToLoad
      && now - lastLoad.at < 1500
    ) {
      return;
    }

    inFlightMemberLoadRef.current = memberIdToLoad;
    lastMemberLoadRef.current = { memberId: memberIdToLoad, at: now };

    try {
      await fetchTodayDoses(memberIdToLoad);

      const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString();
      const { data } = await supabase
        .from('prescriptions')
        .select('medication_name, end_at')
        .eq('family_member_id', memberIdToLoad)
        .eq('status', 'active')
        .not('end_at', 'is', null)
        .lte('end_at', sevenDays)
        .order('end_at', { ascending: true });

      if (selectedMemberRef.current === memberIdToLoad) {
        setExpiringMeds(data ?? []);
      }
    } finally {
      if (inFlightMemberLoadRef.current === memberIdToLoad) {
        inFlightMemberLoadRef.current = null;
      }
    }
  }, [fetchTodayDoses]);

  useEffect(() => {
    let cancelled = false;

    async function syncMembers() {
      const currentMembers = await ensureMembersLoaded();
      if (cancelled) return;

      if (currentMembers.length === 0) {
        setSelectedMember(null);
        setExpiringMeds([]);
        return;
      }

      setSelectedMember((currentSelected) => {
        const requestedMember = routeMemberId
          ? currentMembers.find((member) => member.id === routeMemberId)
          : null;
        const preservedMember = currentSelected
          ? currentMembers.find((member) => member.id === currentSelected)
          : null;
        const nextMemberId = (requestedMember ?? preservedMember ?? currentMembers[0]).id;
        return currentSelected === nextMemberId ? currentSelected : nextMemberId;
      });
    }

    void syncMembers();
    return () => {
      cancelled = true;
    };
  }, [ensureMembersLoaded, routeMemberId]);

  useEffect(() => {
    if (!selectedMember) {
      setExpiringMeds([]);
      return;
    }

    void loadMemberData(selectedMember);
  }, [loadMemberData, selectedMember]);

  useFocusEffect(useCallback(() => {
    const memberIdToRefresh = selectedMemberRef.current;
    if (!memberIdToRefresh) {
      return;
    }

    const now = Date.now();
    const lastFocusRefresh = lastFocusRefreshRef.current;
    if (
      lastFocusRefresh.memberId === memberIdToRefresh
      && now - lastFocusRefresh.at < 2000
    ) {
      return;
    }

    lastFocusRefreshRef.current = { memberId: memberIdToRefresh, at: now };
    void loadMemberData(memberIdToRefresh, { force: true });

    return undefined;
  }, [loadMemberData]));

  function selectMember(id: string) {
    setSelectedMember(id);
  }

  async function handleMark(scheduleId: string, status: ScheduleStatus) {
    const err = await markDose(scheduleId, status);
    if (err) Alert.alert('Error', err);
  }

  const pending = doses.filter(d => d.status === 'pending' || d.status === 'late');
  const done    = doses.filter(d => d.status === 'taken' || d.status === 'skipped');
  const selectedMemberData = members.find((member) => member.id === selectedMember) ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Medicamentos</Text>
        <Text style={styles.subtitle}>
          {selectedMemberData ? `Dosis de hoy de ${selectedMemberData.first_name}` : 'Dosis de hoy'}
        </Text>
      </View>

      {members.length > 1 && (
        <View style={styles.selectorSection}>
          <Text style={styles.selectorLabel}>Selecciona el familiar que quieres revisar</Text>
          <View style={styles.memberTabs}>
            {members.map(m => {
              const isActive = selectedMember === m.id;

              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.memberTab, isActive && styles.memberTabActive]}
                  onPress={() => selectMember(m.id)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.memberAvatar, isActive && styles.memberAvatarActive]}>
                    <Text style={[styles.memberAvatarText, isActive && styles.memberAvatarTextActive]}>
                      {m.first_name.charAt(0).toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.memberTabCopy}>
                    <Text style={[styles.memberTabText, isActive && styles.memberTabTextActive]}>
                      {getMemberDisplayName(m)}
                    </Text>
                    <Text style={[styles.memberTabHint, isActive && styles.memberTabHintActive]}>
                      {isActive ? 'Mostrando sus dosis de hoy' : 'Toca para ver sus dosis'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {expiringMeds.length > 0 && (
        <View style={styles.expiringBanner}>
          <Ionicons name="warning-outline" size={16} color={Colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.expiringTitle}>Tratamientos por vencer</Text>
            {expiringMeds.map((m, i) => {
              const days = Math.ceil((new Date(m.end_at).getTime() - Date.now()) / 86400000);
              const label = days < 0 ? 'Vencido' : days === 0 ? 'Vence hoy' : `${days} día${days !== 1 ? 's' : ''}`;
              return (
                <Text key={i} style={styles.expiringItem}>
                  {m.medication_name} · <Text style={{ color: days <= 0 ? Colors.alert : Colors.warning }}>{label}</Text>
                </Text>
              );
            })}
          </View>
        </View>
      )}

      {loading
        ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        : (
          <ScrollView contentContainerStyle={styles.list}>
            {doses.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="checkmark-circle-outline" size={56} color={Colors.healthy} />
                <Text style={styles.emptyTitle}>Sin dosis pendientes</Text>
                <Text style={styles.emptyText}>
                  {selectedMemberData
                    ? `No hay medicamentos programados para hoy para ${selectedMemberData.first_name}.`
                    : 'No hay medicamentos programados para hoy.'}
                </Text>
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
  expiringBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    marginHorizontal: Spacing.base, marginBottom: Spacing.sm,
    backgroundColor: '#2A1E0A', borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: '#F5A62344',
  },
  expiringTitle: { color: '#F5A623', fontSize: Typography.sm, fontWeight: Typography.bold, marginBottom: 2 },
  expiringItem: { color: '#8BA0B8', fontSize: Typography.xs, marginTop: 2 },
  title: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.sm },
  selectorSection: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  selectorLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    paddingHorizontal: Spacing.base,
  },
  memberTabs: {
    paddingHorizontal: Spacing.base,
    gap: Spacing.sm,
  },
  memberTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 68,
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memberTabActive: {
    backgroundColor: Colors.primary + '16',
    borderColor: Colors.primary,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memberAvatarActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  memberAvatarText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
  memberAvatarTextActive: {
    color: Colors.white,
  },
  memberTabCopy: {
    flex: 1,
    gap: 2,
  },
  memberTabText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  memberTabTextActive: { color: Colors.white },
  memberTabHint: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  memberTabHintActive: {
    color: Colors.primaryLight,
  },
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
