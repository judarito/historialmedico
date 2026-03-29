import { useEffect, useState, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../services/supabase';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../theme';
import type { Database } from '../../../types/database.types';

type MedicalVisit   = Database['public']['Tables']['medical_visits']['Row'];
type MedicalDocument = Database['public']['Tables']['medical_documents']['Row'];

const STATUS_LABEL: Record<string, { label: string; color: string; icon: any }> = {
  pending:   { label: 'Pendiente',   color: Colors.warning, icon: 'time-outline' },
  processing:{ label: 'Procesando',  color: Colors.info,    icon: 'sync-outline' },
  processed: { label: 'Procesado',   color: Colors.healthy, icon: 'checkmark-circle-outline' },
  verified:  { label: 'Verificado',  color: Colors.healthy, icon: 'shield-checkmark-outline' },
  failed:    { label: 'Error',       color: Colors.alert,   icon: 'alert-circle-outline' },
};

const DOC_TYPE_LABEL: Record<string, string> = {
  formula:      'Fórmula médica',
  lab_result:   'Resultado de laboratorio',
  imaging:      'Imagen diagnóstica',
  prescription: 'Receta',
  other:        'Documento',
};

export default function VisitDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [visit,     setVisit]     = useState<MedicalVisit | null>(null);
  const [docs,      setDocs]      = useState<MedicalDocument[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);

  // Recargar al volver del scan (después de adjuntar un documento)
  useFocusEffect(useCallback(() => { load(); }, [id]));

  async function load() {
    if (!id) return;
    const [visitRes, docsRes] = await Promise.all([
      supabase.from('medical_visits').select('*').eq('id', id).single(),
      supabase
        .from('medical_documents')
        .select('*')
        .eq('medical_visit_id', id)
        .order('created_at', { ascending: false }),
    ]);
    if (visitRes.data) setVisit(visitRes.data);
    setDocs(docsRes.data ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  function handleAttach() {
    if (!visit) return;
    router.push({
      pathname: '/(app)/(tabs)/scan',
      params: {
        memberId: visit.family_member_id,
        visitId:  visit.id,
      },
    });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!visit) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyCenter}>
          <Text style={styles.emptyText}>Visita no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const visitDateFormatted = new Date(visit.visit_date).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const visitTimeFormatted = new Date(visit.visit_date).toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Detalle de visita</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {visit.doctor_name ?? 'Sin médico'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={handleAttach}
          activeOpacity={0.8}
        >
          <Ionicons name="camera-outline" size={18} color={Colors.white} />
          <Text style={styles.attachBtnText}>Adjuntar</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* ── Datos de la visita ── */}
        <View style={styles.card}>
          {/* Fecha */}
          <View style={styles.dateRow}>
            <View style={styles.dateIcon}>
              <Ionicons name="calendar" size={22} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.dateMain}>{visitDateFormatted}</Text>
              <Text style={styles.dateSub}>{visitTimeFormatted}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Campos informativos */}
          {visit.doctor_name && (
            <InfoRow icon="person-outline" label="Médico" value={visit.doctor_name} />
          )}
          {visit.specialty && (
            <InfoRow icon="medical-outline" label="Especialidad" value={visit.specialty} />
          )}
          {visit.institution_name && (
            <InfoRow icon="business-outline" label="Institución" value={visit.institution_name} />
          )}
          {visit.reason_for_visit && (
            <InfoRow icon="help-circle-outline" label="Motivo" value={visit.reason_for_visit} />
          )}
          {visit.diagnosis && (
            <InfoRow icon="document-text-outline" label="Diagnóstico" value={visit.diagnosis} multiline />
          )}
          {visit.notes && (
            <InfoRow icon="chatbox-ellipses-outline" label="Notas" value={visit.notes} multiline />
          )}
        </View>

        {/* ── Signos vitales ── */}
        {hasVitals(visit) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Signos vitales</Text>
            <View style={styles.vitalsGrid}>
              {visit.weight_kg != null && (
                <VitalChip icon="barbell-outline" label="Peso" value={`${visit.weight_kg} kg`} />
              )}
              {visit.height_cm != null && (
                <VitalChip icon="resize-outline" label="Talla" value={`${visit.height_cm} cm`} />
              )}
              {visit.temperature_c != null && (
                <VitalChip icon="thermometer-outline" label="Temp." value={`${visit.temperature_c} °C`} color={visit.temperature_c > 37.5 ? Colors.alert : undefined} />
              )}
              {visit.blood_pressure && (
                <VitalChip icon="pulse-outline" label="T/A" value={visit.blood_pressure} />
              )}
              {visit.heart_rate != null && (
                <VitalChip icon="heart-outline" label="FC" value={`${visit.heart_rate} lpm`} />
              )}
            </View>
          </View>
        )}

        {/* ── Documentos adjuntos ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Documentos adjuntos{docs.length > 0 ? ` (${docs.length})` : ''}
            </Text>
            <TouchableOpacity onPress={handleAttach} style={styles.addDocBtn}>
              <Ionicons name="add" size={16} color={Colors.primary} />
              <Text style={styles.addDocText}>Adjuntar</Text>
            </TouchableOpacity>
          </View>

          {docs.length === 0 ? (
            <TouchableOpacity style={styles.emptyDocs} onPress={handleAttach} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={36} color={Colors.textMuted} />
              <Text style={styles.emptyDocsTitle}>Sin documentos adjuntos</Text>
              <Text style={styles.emptyDocsSub}>
                Toca para fotografiar una fórmula, resultado o cualquier documento médico.
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.docsList}>
              {docs.map(doc => {
                const st = STATUS_LABEL[doc.processing_status] ?? STATUS_LABEL.pending;
                return (
                  <View key={doc.id} style={styles.docCard}>
                    <View style={[styles.docIconWrap, { backgroundColor: Colors.primary + '18' }]}>
                      <Ionicons name="document-attach-outline" size={22} color={Colors.primary} />
                    </View>
                    <View style={styles.docInfo}>
                      <Text style={styles.docType}>
                        {DOC_TYPE_LABEL[doc.document_type ?? ''] ?? 'Documento'}
                      </Text>
                      <Text style={styles.docDate}>
                        {new Date(doc.created_at).toLocaleDateString('es-CO', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: st.color + '22' }]}>
                      <Ionicons name={st.icon} size={12} color={st.color} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasVitals(v: MedicalVisit) {
  return v.weight_kg != null || v.height_cm != null || v.temperature_c != null ||
    v.blood_pressure != null || v.heart_rate != null;
}

function InfoRow({ icon, label, value, multiline }: {
  icon: any; label: string; value: string; multiline?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={Colors.textMuted} style={styles.infoIcon} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={multiline ? 0 : 2}>{value}</Text>
      </View>
    </View>
  );
}

function VitalChip({ icon, label, value, color }: {
  icon: any; label: string; value: string; color?: string;
}) {
  const col = color ?? Colors.textPrimary;
  return (
    <View style={styles.vitalChip}>
      <Ionicons name={icon} size={16} color={col} />
      <Text style={styles.vitalLabel}>{label}</Text>
      <Text style={[styles.vitalValue, { color: col }]}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

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
  headerCenter: { flex: 1, alignItems: 'center', gap: 2 },
  headerTitle:  { color: Colors.textPrimary,   fontSize: Typography.md, fontWeight: Typography.bold },
  headerSub:    { color: Colors.textSecondary, fontSize: Typography.xs },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, height: 38,
  },
  attachBtnText: { color: Colors.white, fontSize: Typography.sm, fontWeight: Typography.semibold },

  content: { padding: Spacing.base, gap: Spacing.base },

  // Main card
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, gap: Spacing.sm,
    ...Shadow.card,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dateIcon: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center',
  },
  dateMain: { color: Colors.textPrimary,   fontSize: Typography.base, fontWeight: Typography.semibold, textTransform: 'capitalize' },
  dateSub:  { color: Colors.textSecondary, fontSize: Typography.xs },
  divider:  { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  infoRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  infoIcon: { marginTop: 3 },
  infoLabel:{ color: Colors.textMuted,    fontSize: Typography.xs, fontWeight: Typography.medium },
  infoValue:{ color: Colors.textPrimary,  fontSize: Typography.sm, marginTop: 1, lineHeight: 18 },

  // Vitals
  section:       { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:  { color: Colors.textPrimary, fontSize: Typography.md, fontWeight: Typography.bold },
  addDocBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addDocText:    { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },

  vitalsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
  },
  vitalChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  vitalLabel: { color: Colors.textMuted,    fontSize: Typography.xs },
  vitalValue: { color: Colors.textPrimary,  fontSize: Typography.sm, fontWeight: Typography.semibold },

  // Documents
  emptyDocs: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm,
  },
  emptyDocsTitle: { color: Colors.textSecondary, fontSize: Typography.base, fontWeight: Typography.semibold },
  emptyDocsSub:   { color: Colors.textMuted,     fontSize: Typography.sm,  textAlign: 'center', lineHeight: 18 },

  docsList: { gap: Spacing.sm },
  docCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  docIconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  docInfo:     { flex: 1, gap: 2 },
  docType:     { color: Colors.textPrimary,   fontSize: Typography.sm, fontWeight: Typography.medium },
  docDate:     { color: Colors.textSecondary, fontSize: Typography.xs },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  statusText:  { fontSize: Typography.xs, fontWeight: Typography.medium },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:   { color: Colors.textMuted, fontSize: Typography.base },
});
