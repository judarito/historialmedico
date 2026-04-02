import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../theme';
import { calculateAge, formatCalendarDate } from '../../utils';

interface ActiveMedication {
  medication_name: string;
  dose_amount: string | null;
  dose_unit: string | null;
  frequency_text: string | null;
  status: string;
}

interface RecentVisit {
  id: string;
  visit_date: string | null;
  doctor_name: string | null;
  specialty: string | null;
  diagnosis: string | null;
  reason: string | null;
}

interface PendingTest {
  test_name: string;
  status: string;
  ordered_date: string | null;
}

interface SharedSummary {
  member: {
    full_name: string;
    birth_date: string | null;
    blood_type: string | null;
    allergies: string | null;
    chronic_conditions: string | null;
  };
  active_medications: ActiveMedication[];
  recent_visits: RecentVisit[];
  pending_tests: PendingTest[];
}

export default function SharedHealthSummaryScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();

  const [summary, setSummary] = useState<SharedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Enlace inválido.');
      setLoading(false);
      return;
    }
    loadSummary();
  }, [token]);

  async function loadSummary() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_shared_health_summary', {
        p_token: token as string,
      });
      if (rpcError) throw rpcError;
      if (!data || (data as { error?: string }).error) {
        setError((data as { error?: string })?.error ?? 'Enlace inválido o expirado.');
        return;
      }
      setSummary(data as SharedSummary);
    } catch {
      setError('No se pudo cargar el historial. El enlace puede haber expirado.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Cargando historial...</Text>
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.errorIcon}>
          <Ionicons name="link-outline" size={44} color={Colors.alert} />
        </View>
        <Text style={styles.errorTitle}>Enlace inválido o expirado</Text>
        <Text style={styles.errorMessage}>
          {error ?? 'Este enlace ya no está disponible.'}
        </Text>
      </SafeAreaView>
    );
  }

  const { member, active_medications, recent_visits, pending_tests } = summary;
  const age = calculateAge(member.birth_date);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header simple */}
      <View style={styles.header}>
        <Ionicons name="heart-outline" size={22} color={Colors.alert} />
        <Text style={styles.headerTitle}>Historial de Salud</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Nombre + badge */}
        <View style={styles.memberHeader}>
          <View style={styles.memberAvatar}>
            <Text style={styles.memberInitial}>
              {member.full_name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{member.full_name}</Text>
            {age !== null && (
              <Text style={styles.memberAge}>{age} años</Text>
            )}
          </View>
          <View style={styles.readOnlyBadge}>
            <Ionicons name="eye-outline" size={11} color={Colors.textMuted} />
            <Text style={styles.readOnlyText}>Solo lectura</Text>
          </View>
        </View>

        {/* Datos básicos */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Datos básicos</Text>
          <View style={styles.dataRow}>
            <Ionicons name="water" size={15} color={Colors.alert} />
            <Text style={styles.dataLabel}>Tipo de sangre</Text>
            <Text style={[styles.dataValue, { color: member.blood_type ? Colors.alert : Colors.textMuted }]}>
              {member.blood_type ?? 'No registrado'}
            </Text>
          </View>
          {age !== null && (
            <View style={styles.dataRow}>
              <Ionicons name="calendar-outline" size={15} color={Colors.textSecondary} />
              <Text style={styles.dataLabel}>Fecha de nacimiento</Text>
              <Text style={styles.dataValue}>{formatCalendarDate(member.birth_date)}</Text>
            </View>
          )}
        </View>

        {/* Alergias */}
        {member.allergies && (
          <View style={[styles.card, styles.alertCard]}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="alert-circle" size={16} color={Colors.alert} />
              <Text style={[styles.cardTitle, { color: Colors.alert, marginLeft: Spacing.xs }]}>
                Alergias
              </Text>
            </View>
            <Text style={[styles.bodyText, { color: Colors.alert }]}>{member.allergies}</Text>
          </View>
        )}

        {/* Condiciones crónicas */}
        {member.chronic_conditions && (
          <View style={[styles.card, styles.warningCard]}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="medical" size={16} color={Colors.warning} />
              <Text style={[styles.cardTitle, { color: Colors.warning, marginLeft: Spacing.xs }]}>
                Condiciones crónicas
              </Text>
            </View>
            <Text style={[styles.bodyText, { color: Colors.warning }]}>{member.chronic_conditions}</Text>
          </View>
        )}

        {/* Medicamentos activos */}
        {active_medications.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="medkit" size={16} color={Colors.healthy} />
              <Text style={[styles.cardTitle, { marginLeft: Spacing.xs }]}>
                Medicamentos activos ({active_medications.length})
              </Text>
            </View>
            {active_medications.map((med, idx) => (
              <View key={idx} style={styles.listRow}>
                <View style={styles.listDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listPrimary}>{med.medication_name}</Text>
                  {(med.dose_amount || med.frequency_text) && (
                    <Text style={styles.listSecondary}>
                      {[
                        med.dose_amount ? `${med.dose_amount}${med.dose_unit ?? ''}` : null,
                        med.frequency_text,
                      ]
                        .filter(Boolean)
                        .join(' — ')}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Visitas recientes */}
        {recent_visits.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="calendar" size={16} color={Colors.primary} />
              <Text style={[styles.cardTitle, { marginLeft: Spacing.xs }]}>
                Visitas recientes ({recent_visits.length})
              </Text>
            </View>
            {recent_visits.map((visit, idx) => (
              <View key={visit.id ?? idx} style={[styles.listRow, { alignItems: 'flex-start' }]}>
                <View style={[styles.listDot, { marginTop: 7, backgroundColor: Colors.primary }]} />
                <View style={{ flex: 1 }}>
                  {visit.visit_date && (
                    <Text style={styles.listDate}>{formatCalendarDate(visit.visit_date)}</Text>
                  )}
                  {visit.doctor_name && (
                    <Text style={styles.listPrimary}>{visit.doctor_name}</Text>
                  )}
                  {visit.specialty && (
                    <Text style={styles.listSecondary}>{visit.specialty}</Text>
                  )}
                  {visit.diagnosis && (
                    <Text style={styles.listSecondary}>
                      Diagnóstico: {visit.diagnosis}
                    </Text>
                  )}
                  {!visit.diagnosis && visit.reason && (
                    <Text style={styles.listSecondary}>Motivo: {visit.reason}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Exámenes pendientes */}
        {pending_tests.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="flask" size={16} color={Colors.warning} />
              <Text style={[styles.cardTitle, { marginLeft: Spacing.xs }]}>
                Exámenes pendientes ({pending_tests.length})
              </Text>
            </View>
            {pending_tests.map((test, idx) => (
              <View key={idx} style={styles.listRow}>
                <View style={[styles.listDot, { backgroundColor: Colors.warning }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listPrimary}>{test.test_name}</Text>
                  {test.ordered_date && (
                    <Text style={styles.listSecondary}>
                      Ordenado: {formatCalendarDate(test.ordered_date)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Compartido vía Family Health Tracker · Solo lectura · Generado por el titular de los datos
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: Radius.full,
    backgroundColor: Colors.alertBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  errorTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    textAlign: 'center',
  },
  errorMessage: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    ...Shadow.subtle,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary + '30',
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  memberInitial: {
    color: Colors.primary,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  memberAge: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    marginTop: 2,
  },
  readOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  readOnlyText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    ...Shadow.subtle,
  },
  alertCard: {
    backgroundColor: Colors.alertBg,
    borderColor: Colors.alert + '50',
  },
  warningCard: {
    backgroundColor: Colors.warningBg,
    borderColor: Colors.warning + '50',
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    marginBottom: Spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  bodyText: {
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dataLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    flex: 1,
  },
  dataValue: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm - 1,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '80',
  },
  listDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.healthy,
    marginRight: Spacing.sm,
    flexShrink: 0,
  },
  listDate: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    marginBottom: 2,
  },
  listPrimary: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  listSecondary: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    marginTop: 1,
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    flex: 1,
    lineHeight: 16,
  },
});
