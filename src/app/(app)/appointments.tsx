import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import type { Database } from '../../types/database.types';
import { formatCalendarDate, formatDateTimeLabel, getDateOnlyKey } from '../../utils';

type MedicalVisit = Database['public']['Tables']['medical_visits']['Row'];
type FamilyMember = Database['public']['Tables']['family_members']['Row'];

type DayOption = {
  key: string;
  label: string;
  shortLabel: string;
};

function getMemberName(member: FamilyMember | undefined): string {
  if (!member) return 'Familiar';
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
}

function buildDayLabel(dateKey: string): DayOption {
  const today = getDateOnlyKey(new Date().toISOString());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getDateOnlyKey(tomorrowDate.toISOString());

  if (dateKey === today) {
    return { key: dateKey, label: 'Hoy', shortLabel: 'Hoy' };
  }

  if (dateKey === tomorrow) {
    return { key: dateKey, label: 'Mañana', shortLabel: 'Mañana' };
  }

  return {
    key: dateKey,
    label: formatCalendarDate(dateKey, { weekday: 'long', day: 'numeric', month: 'short' }),
    shortLabel: formatCalendarDate(dateKey, { day: 'numeric', month: 'short' }),
  };
}

export default function AppointmentsScreen() {
  const { tenant, members, fetchMembers } = useFamilyStore();
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<MedicalVisit[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>('all');

  const loadAppointments = useCallback(async () => {
    const activeTenant = useFamilyStore.getState().tenant;
    if (!activeTenant?.id) {
      setAppointments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const nowIso = new Date().toISOString();
    const membersPromise = members.length === 0
      ? fetchMembers().then(() => useFamilyStore.getState().members)
      : Promise.resolve(null);

    const [{ data: visits }] = await Promise.all([
      supabase
        .from('medical_visits')
        .select('*')
        .eq('tenant_id', activeTenant.id)
        .eq('status', 'scheduled')
        .is('deleted_at', null)
        .gt('visit_date', nowIso)
        .order('visit_date', { ascending: true })
        .limit(80),
      membersPromise,
    ]);

    setAppointments((visits as MedicalVisit[] | null) ?? []);
    setLoading(false);
  }, [fetchMembers, members]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments, tenant?.id]);

  const dayOptions = useMemo(() => {
    const uniqueKeys = Array.from(new Set(appointments.map((appointment) => getDateOnlyKey(appointment.visit_date))));
    return [
      { key: 'all', label: 'Todas', shortLabel: 'Todas' },
      ...uniqueKeys.filter(Boolean).map((key) => buildDayLabel(key)),
    ];
  }, [appointments]);

  useEffect(() => {
    if (selectedDay === 'all') return;
    const exists = dayOptions.some((option) => option.key === selectedDay);
    if (!exists) {
      setSelectedDay(dayOptions[1]?.key ?? 'all');
    }
  }, [dayOptions, selectedDay]);

  const filteredAppointments = useMemo(() => {
    if (selectedDay === 'all') return appointments;
    return appointments.filter((appointment) => getDateOnlyKey(appointment.visit_date) === selectedDay);
  }, [appointments, selectedDay]);

  const groupedAppointments = useMemo(() => {
    return filteredAppointments.reduce<Record<string, MedicalVisit[]>>((acc, appointment) => {
      const key = getDateOnlyKey(appointment.visit_date);
      if (!key) return acc;
      acc[key] = acc[key] ?? [];
      acc[key].push(appointment);
      return acc;
    }, {});
  }, [filteredAppointments]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Agenda de citas</Text>
          <Text style={styles.headerSubtitle}>Programa rápido y revisa tus próximas citas.</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={[styles.quickCard, styles.quickCardPrimary]}
            onPress={() => router.push({ pathname: '/(app)/add-visit', params: { mode: 'schedule', defaultFuture: '1' } })}
            activeOpacity={0.85}
          >
            <View style={styles.quickIconPrimary}>
              <Ionicons name="add-circle-outline" size={18} color={Colors.white} />
            </View>
            <Text style={styles.quickTitlePrimary}>Agendar cita express</Text>
            <Text style={styles.quickTextPrimary}>Abre un formulario corto con fecha futura sugerida.</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => {
              setSelectedDay('all');
              void loadAppointments();
            }}
            activeOpacity={0.85}
          >
            <View style={styles.quickIconSecondary}>
              <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
            </View>
            <Text style={styles.quickTitle}>Actualizar agenda</Text>
            <Text style={styles.quickText}>Vuelve a consultar citas programadas y recordatorios futuros.</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filtersBlock}>
          <Text style={styles.sectionTitle}>Scheduler</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayList}>
            {dayOptions.map((option) => {
              const active = selectedDay === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  onPress={() => setSelectedDay(option.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.dayChipLabel, active && styles.dayChipLabelActive]}>{option.shortLabel}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={styles.loading} />
        ) : appointments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={44} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Aún no hay citas futuras</Text>
            <Text style={styles.emptyText}>Puedes programar una en segundos desde el acceso rápido de arriba.</Text>
          </View>
        ) : (
          Object.entries(groupedAppointments).map(([dayKey, items]) => (
            <View key={dayKey} style={styles.daySection}>
              <Text style={styles.daySectionTitle}>{buildDayLabel(dayKey).label}</Text>
              {items.map((appointment) => {
                const member = members.find((item) => item.id === appointment.family_member_id);
                return (
                  <TouchableOpacity
                    key={appointment.id}
                    style={styles.card}
                    onPress={() => router.push({ pathname: '/(app)/visit/[id]', params: { id: appointment.id } })}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardTop}>
                      <View style={styles.cardTimeWrap}>
                        <Ionicons name="time-outline" size={14} color={Colors.primary} />
                        <Text style={styles.cardTime}>
                          {formatDateTimeLabel(appointment.visit_date, { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusBadgeText}>Programada</Text>
                      </View>
                    </View>

                    <Text style={styles.cardTitle}>{appointment.doctor_name ?? 'Cita médica'}</Text>
                    <Text style={styles.cardMeta}>
                      {appointment.specialty ?? appointment.reason_for_visit ?? 'Sin especialidad registrada'}
                    </Text>
                    <Text style={styles.cardMetaSecondary}>
                      {getMemberName(member)}
                      {appointment.institution_name ? ` · ${appointment.institution_name}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    gap: Spacing.lg,
  },
  quickRow: {
    gap: Spacing.sm,
  },
  quickCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  quickCardPrimary: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary + '44',
  },
  quickIconPrimary: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickIconSecondary: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitlePrimary: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  quickTextPrimary: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 19,
  },
  quickTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  quickText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 19,
  },
  filtersBlock: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  dayList: {
    gap: Spacing.sm,
    paddingRight: Spacing.base,
  },
  dayChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  dayChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayChipLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  dayChipLabelActive: {
    color: Colors.white,
  },
  loading: {
    marginTop: Spacing.xl,
  },
  emptyCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
    textAlign: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  daySection: {
    gap: Spacing.sm,
  },
  daySectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  card: {
    gap: Spacing.xs,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  cardTimeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTime: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.infoBg,
    borderWidth: 1,
    borderColor: Colors.info + '33',
  },
  statusBadgeText: {
    color: Colors.info,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },
  cardMeta: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  cardMetaSecondary: {
    color: Colors.textMuted,
    fontSize: Typography.sm,
  },
  bottomPad: {
    height: Spacing.xxxl,
  },
});
