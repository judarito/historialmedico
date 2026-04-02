import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../services/supabase';
import { useFamilyStore } from '../../../store/familyStore';
import { useMedicationStore } from '../../../store/medicationStore';
import { Avatar } from '../../../components/ui/Avatar';
import { SupplyBadge } from '../../../components/ui/SupplyBadge';
import { AdherenceCard } from '../../../components/ui/AdherenceCard';
import { VitalsChartsSection } from '../../../components/ui/VitalsChartsSection';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../theme';
import type { Database } from '../../../types/database.types';
import { calculateAge, formatCalendarDate } from '../../../utils';

type FamilyMember  = Database['public']['Tables']['family_members']['Row'];
type MedicalVisit  = Database['public']['Tables']['medical_visits']['Row'];
type Prescription  = Database['public']['Tables']['prescriptions']['Row'];
type MedicalTest   = Database['public']['Tables']['medical_tests']['Row'];

interface MemberData {
  member:         FamilyMember;
  upcomingVisits: MedicalVisit[];
  recentVisits:   MedicalVisit[];
  activeMeds:     Prescription[];
  pendingTests:   MedicalTest[];
}

function sortVisitsByDateDesc(visits: MedicalVisit[]): MedicalVisit[] {
  return [...visits].sort((a, b) => {
    const aTime = a.visit_date ? new Date(a.visit_date).getTime() : 0;
    const bTime = b.visit_date ? new Date(b.visit_date).getTime() : 0;
    return bTime - aTime;
  });
}

export default function MemberDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { members } = useFamilyStore();
  const { fetchTodayDoses, doses, currentMemberId } = useMedicationStore();
  const [data,    setData]    = useState<MemberData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    const memberId = id as string;

    // Primero intentar del store local
    const localMember = members.find(m => m.id === memberId);

    const nowIso = new Date().toISOString();

    const [memberRes, upcomingVisitsRes, visitsRes, medsRes, testsRes] = await Promise.all([
      localMember
        ? Promise.resolve({ data: localMember, error: null })
        : supabase.from('family_members').select('*').eq('id', memberId).single(),
      supabase.from('medical_visits').select('*').eq('family_member_id', memberId).eq('status', 'scheduled').is('deleted_at', null).gt('visit_date', nowIso).order('visit_date', { ascending: true }).limit(3),
      supabase.from('medical_visits').select('*').eq('family_member_id', memberId).eq('status', 'completed').is('deleted_at', null).order('visit_date', { ascending: false }).limit(5),
      supabase.from('prescriptions').select('*').eq('family_member_id', memberId).eq('status', 'active').order('created_at', { ascending: false }),
      supabase.from('medical_tests').select('*').eq('family_member_id', memberId).in('status', ['pending', 'scheduled']).order('due_at', { ascending: true }),
    ]);

    if (memberRes.data) {
      setData({
        member:         memberRes.data as FamilyMember,
        upcomingVisits: upcomingVisitsRes.data ?? [],
        recentVisits:   sortVisitsByDateDesc((visitsRes.data as MedicalVisit[] | null) ?? []),
        activeMeds:     medsRes.data ?? [],
        pendingTests:   testsRes.data ?? [],
      });
    }

    fetchTodayDoses(memberId);
    setLoading(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.sectionTitle, { textAlign: 'center', marginTop: 80 }]}>Miembro no encontrado</Text>
      </SafeAreaView>
    );
  }

  const { member, upcomingVisits, recentVisits, activeMeds, pendingTests } = data;
  const fullName  = `${member.first_name} ${member.last_name ?? ''}`.trim();
  const age       = calculateAge(member.birth_date);
  const todayDoses = currentMemberId === member.id
    ? doses.filter(d => d.status === 'pending' || d.status === 'late')
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{member.first_name}</Text>
          <Text style={styles.headerSub}>Perfil de salud</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionBtn} onPress={() => router.push({ pathname: '/(app)/edit-member', params: { memberId: id } })}>
            <Ionicons name="create-outline" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerActionBtn, { backgroundColor: Colors.primary + '22', borderColor: Colors.primary + '44' }]} onPress={() => router.push({ pathname: '/(app)/(tabs)/scan', params: { memberId: id } })}>
            <Ionicons name="camera-outline" size={18} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Tarjeta de perfil */}
        <View style={styles.profileCard}>
          <Avatar name={member.first_name} imageUrl={member.avatar_url} size={64} />
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName}</Text>
            {age !== null && <Text style={styles.profileMeta}>{age} años</Text>}
            {member.eps_name && <Text style={styles.profileMeta}>{member.eps_name}</Text>}
            {member.blood_type && <Text style={styles.profileMeta}>Sangre: {member.blood_type}</Text>}
          </View>
        </View>

        {/* Alergias / Condiciones */}
        {(member.allergies || member.chronic_conditions) && (
          <View style={styles.alertCard}>
            {member.allergies && (
              <InfoChip icon="alert-circle-outline" color={Colors.alert} label={`Alergias: ${member.allergies}`} />
            )}
            {member.chronic_conditions && (
              <InfoChip icon="medical-outline" color={Colors.warning} label={member.chronic_conditions} />
            )}
          </View>
        )}

        {/* Adherencia al tratamiento */}
        <AdherenceCard memberId={id as string} />

        {/* Dosis de hoy */}
        {todayDoses.length > 0 && (
          <Section title={`Dosis pendientes hoy (${todayDoses.length})`} accent={Colors.warning}>
            {todayDoses.slice(0, 3).map(d => (
              <View key={d.schedule_id} style={styles.doseRow}>
                <View style={styles.doseDot} />
                <Text style={styles.doseName}>{d.medication_name}</Text>
                <Text style={styles.doseTime}>
                  {new Date(d.scheduled_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ))}
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(app)/(tabs)/medications', params: { memberId: member.id } })}
            >
              <Text style={styles.seeAllLink}>Ver todas las dosis →</Text>
            </TouchableOpacity>
          </Section>
        )}

        {/* Medicamentos activos */}
        <Section title={`Medicamentos activos (${activeMeds.length})`}>
          {activeMeds.length === 0
            ? <Text style={styles.emptyText}>Sin medicamentos activos</Text>
            : activeMeds.map(m => (
              <View key={m.id} style={styles.medRow}>
                <Ionicons name="medkit-outline" size={16} color={Colors.info} />
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{m.medication_name}</Text>
                  <Text style={styles.medMeta}>
                    {m.dose_amount && `${m.dose_amount} ${m.dose_unit ?? ''}`}
                    {m.frequency_text && ` · ${m.frequency_text}`}
                  </Text>
                </View>
                <SupplyBadge end_at={m.end_at} />
              </View>
            ))
          }
        </Section>

        {/* Exámenes pendientes */}
        {pendingTests.length > 0 && (
          <Section title={`Exámenes pendientes (${pendingTests.length})`} accent={Colors.info}>
            {pendingTests.map(t => (
              <View key={t.id} style={styles.testRow}>
                <Ionicons name="flask-outline" size={16} color={Colors.info} />
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{t.test_name}</Text>
                  {t.due_at && (
                    <Text style={styles.medMeta}>
                      Vence: {new Date(t.due_at).toLocaleDateString('es-CO')}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </Section>
        )}

        {/* Proximas citas */}
        {upcomingVisits.length > 0 && (
          <Section title={`Proximas citas (${upcomingVisits.length})`} accent={Colors.info}>
            {upcomingVisits.map((visit) => (
              <TouchableOpacity
                key={visit.id}
                style={styles.visitRow}
                onPress={() => router.push({ pathname: '/(app)/visit/[id]', params: { id: visit.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.visitDate}>
                  <Text style={styles.visitDay}>
                    {formatCalendarDate(visit.visit_date, { day: '2-digit', month: 'short' })}
                  </Text>
                </View>
                <View style={styles.visitInfo}>
                  <Text style={styles.visitDoctor}>{visit.doctor_name ?? 'Cita medica'}</Text>
                  <Text style={styles.visitSpecialty}>
                    {visit.specialty ?? visit.reason_for_visit ?? 'Sin detalle clinico'}
                  </Text>
                  <Text style={styles.visitDiag}>
                    {new Date(visit.visit_date).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Section>
        )}

        {/* Acciones rápidas */}
        <View style={styles.quickActions}>
          <QuickAction icon="add-circle-outline" color={Colors.primary} label="Nueva visita" onPress={() => router.push({ pathname: '/(app)/add-visit', params: { memberId: id, memberName: member.first_name } })} />
          <QuickAction icon="time-outline" color={Colors.info} label="Historial" onPress={() => router.push({ pathname: '/(app)/history', params: { memberId: id, memberName: member.first_name } })} />
          <QuickAction
            icon="medkit-outline"
            color={Colors.warning}
            label="Dosis hoy"
            onPress={() => router.push({ pathname: '/(app)/(tabs)/medications', params: { memberId: member.id } })}
          />
          <QuickAction icon="shield-checkmark-outline" color={Colors.alert} label="Emergencia" onPress={() => router.push({ pathname: '/(app)/member/emergency-card', params: { memberId: id } })} />
          <QuickAction icon="share-outline" color={Colors.primary} label="Compartir" onPress={() => router.push({ pathname: '/(app)/member/share-history', params: { memberId: id, memberName: member.first_name } })} />
        </View>

        {/* Tendencias de salud */}
        <VitalsChartsSection memberId={id as string} />

        {/* Visitas recientes */}
        <Section title="Visitas médicas recientes">
          {recentVisits.length === 0
            ? <Text style={styles.emptyText}>Sin visitas registradas</Text>
            : recentVisits.map(v => (
              <TouchableOpacity
                key={v.id}
                style={styles.visitRow}
                onPress={() => router.push({ pathname: '/(app)/visit/[id]', params: { id: v.id } })}
                activeOpacity={0.7}
              >
                <View style={styles.visitDate}>
                  <Text style={styles.visitDay}>
                    {formatCalendarDate(v.visit_date, { day: '2-digit', month: 'short' })}
                  </Text>
                </View>
                <View style={styles.visitInfo}>
                  <Text style={styles.visitDoctor}>{v.doctor_name ?? 'Médico sin nombre'}</Text>
                  <Text style={styles.visitSpecialty}>{v.specialty ?? v.reason_for_visit ?? ''}</Text>
                  {v.diagnosis && <Text style={styles.visitDiag} numberOfLines={1}>{v.diagnosis}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))
          }
        </Section>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, accent && { color: accent }]}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function QuickAction({ icon, color, label, onPress }: { icon: any; color: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickActionBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.quickActionIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function InfoChip({ icon, color, label }: { icon: any; color: string; label: string }) {
  return (
    <View style={styles.chipRow}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 38, height: 38, backgroundColor: Colors.surface,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center', gap: 3 },
  headerName: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  headerSub: { color: Colors.textSecondary, fontSize: Typography.sm },
  headerActions: { flexDirection: 'row', gap: Spacing.xs },
  headerActionBtn: {
    width: 38, height: 38, backgroundColor: Colors.surface,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  quickActions: { flexDirection: 'row', gap: Spacing.sm },
  quickActionBtn: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  quickActionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { color: Colors.textSecondary, fontSize: Typography.xs, textAlign: 'center' },

  content: { padding: Spacing.base, gap: Spacing.base },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.base, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.card,
  },
  profileInfo: { flex: 1, gap: 4 },
  profileName: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  profileMeta: { color: Colors.textSecondary, fontSize: Typography.sm },

  alertCard: {
    backgroundColor: Colors.alertBg, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.alert + '33', gap: Spacing.sm,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chipText: { fontSize: Typography.sm, flex: 1 },

  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: Typography.md, fontWeight: Typography.bold },
  sectionCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, gap: Spacing.sm,
  },
  emptyText: { color: Colors.textMuted, fontSize: Typography.sm },
  seeAllLink: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.medium, marginTop: 4 },

  doseRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  doseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  doseName: { color: Colors.textPrimary, fontSize: Typography.sm, flex: 1 },
  doseTime: { color: Colors.textSecondary, fontSize: Typography.xs },

  medRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  testRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  medInfo: { flex: 1, gap: 2 },
  medName: { color: Colors.textPrimary, fontSize: Typography.sm, fontWeight: Typography.medium },
  medMeta: { color: Colors.textSecondary, fontSize: Typography.xs },

  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  visitDate: {
    width: 46,
    minHeight: 46,
    backgroundColor: Colors.surfaceHigh,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  visitDay: { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.bold, textAlign: 'center' },
  visitInfo: { flex: 1, gap: 4 },
  visitDoctor: { color: Colors.textPrimary, fontSize: Typography.sm, fontWeight: Typography.medium },
  visitSpecialty: { color: Colors.textSecondary, fontSize: Typography.xs },
  visitDiag: { color: Colors.textMuted, fontSize: Typography.xs, fontStyle: 'italic' },
});
