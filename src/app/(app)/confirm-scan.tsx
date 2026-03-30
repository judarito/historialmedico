import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { Colors, Typography, Spacing, Radius } from '../../theme';

interface ExtractedMed {
  medication_name: string;
  dose_amount:     number | null;
  dose_unit:       string;
  frequency_text:  string;
  interval_hours:  number | null;
  duration_days:   number | null;
  route:           string;
  instructions:    string;
}

interface ExtractedTest {
  test_name: string;
  category:  string;
  instructions?: string;
}

export default function ConfirmScanRoute() {
  const { documentId, memberName, visitDate, doctorName, manual, processingError } = useLocalSearchParams<{
    documentId: string;
    memberName: string;
    visitId?:   string;
    visitDate?: string;
    doctorName?: string;
    manual?: string;
    processingError?: string;
  }>();
  const [status,   setStatus]   = useState<'loading' | 'ready' | 'error'>('loading');
  const [meds,     setMeds]     = useState<ExtractedMed[]>([]);
  const [tests,    setTests]    = useState<ExtractedTest[]>([]);
  const [saving,   setSaving]   = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [errorMessage, setErrorMessage] = useState(processingError ?? '');

  useEffect(() => {
    if (manual === '1') {
      setStatus('ready');
      return;
    }
    pollDocument();
  }, []);

  async function pollDocument() {
    if (!documentId) return;

    for (let i = 0; i < 12; i++) {  // max 60 seg (12 x 5s)
      await sleep(5000);
      const { data } = await supabase
        .from('medical_documents')
        .select('processing_status, parsed_json, processing_error')
        .eq('id', documentId)
        .single();

      setAttempts(i + 1);

      if (data?.processing_status === 'processed' || data?.processing_status === 'verified') {
        const parsed = data.parsed_json as any;
        setMeds(parsed?.medications ?? []);
        setTests(parsed?.tests ?? []);
        setErrorMessage('');
        setStatus('ready');
        return;
      }
      if (data?.processing_status === 'failed') {
        setErrorMessage(data.processing_error ?? 'No se pudo extraer informacion de la imagen.');
        setStatus('error');
        return;
      }
    }
    setErrorMessage('La imagen se quedo sin respuesta valida del procesador. Puedes completar los datos manualmente.');
    setStatus('error');
  }

  async function handleConfirm() {
    if (!documentId) return;
    setSaving(true);

    const { error } = await supabase.rpc('confirm_document_and_create_records', {
      p_document_id: documentId,
      p_medications: meds as any,
      p_tests:       tests as any,
    });

    setSaving(false);
    if (error) { Alert.alert('Error al guardar', error.message); return; }

    const hasEntries = meds.some(m => m.medication_name.trim()) || tests.some(t => t.test_name.trim());
    Alert.alert(
      '¡Listo!',
      hasEntries
        ? `Se guardaron ${meds.length} medicamento(s) y ${tests.length} examen(es).`
        : 'La foto quedo confirmada sin registros estructurados. Puedes completar la visita manualmente despues.',
      [{ text: 'Ir a medicamentos', onPress: () => router.replace('/(app)/(tabs)/medications') }]
    );
  }

  function updateMed(i: number, field: keyof ExtractedMed, value: string) {
    setMeds(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m));
  }

  function removeMed(i: number) {
    setMeds(prev => prev.filter((_, idx) => idx !== i));
  }

  function addMed() {
    setMeds(prev => [...prev, { medication_name: '', dose_amount: null, dose_unit: 'mg', frequency_text: '', interval_hours: null, duration_days: null, route: 'oral', instructions: '' }]);
  }

  function updateTest(i: number, field: keyof ExtractedTest, value: string) {
    setTests(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }

  function removeTest(i: number) {
    setTests(prev => prev.filter((_, idx) => idx !== i));
  }

  function addTest() {
    setTests(prev => [...prev, { test_name: '', category: '', instructions: '' }]);
  }

  // ── Loading state ────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingTitle}>Analizando con IA...</Text>
          <Text style={styles.loadingText}>Extrayendo medicamentos y exámenes de la fórmula.</Text>
          <Text style={styles.loadingHint}>{attempts > 0 ? `Intento ${attempts}/12 · ~5 seg por intento` : ''}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ───────────────────────────────────────────────
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={56} color={Colors.warning} />
          <Text style={styles.loadingTitle}>No se pudo procesar</Text>
          <Text style={styles.loadingText}>{errorMessage || 'La IA no pudo extraer datos de la imagen. Puedes completar los datos manualmente.'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setStatus('loading'); setAttempts(0); pollDocument(); }}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setStatus('ready'); }}>
            <Text style={[styles.retryText, { color: Colors.textSecondary, marginTop: Spacing.md }]}>
              Agregar manualmente
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Ready — editar y confirmar ────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Confirmar receta</Text>
          <Text style={styles.headerSub}>{memberName}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Visita vinculada */}
      {visitDate ? (
        <View style={styles.visitBadge}>
          <Ionicons name="link-outline" size={14} color={Colors.primary} />
          <Text style={styles.visitBadgeText}>
            Visita: {new Date(visitDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
            {doctorName ? ` · ${doctorName}` : ''}
          </Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {!!errorMessage && (
          <View style={styles.warningBox}>
            <Ionicons name="warning-outline" size={16} color={Colors.warning} />
            <Text style={styles.warningText}>{errorMessage}</Text>
          </View>
        )}

        {/* Medicamentos */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Medicamentos ({meds.length})</Text>
            <TouchableOpacity onPress={addMed} style={styles.addRowBtn}>
              <Ionicons name="add" size={18} color={Colors.primary} />
              <Text style={styles.addRowText}>Agregar</Text>
            </TouchableOpacity>
          </View>

          {meds.length === 0 && (
            <Text style={styles.emptyText}>Sin medicamentos detectados. Toca "Agregar".</Text>
          )}

          {meds.map((m, i) => (
            <View key={i} style={styles.medCard}>
              <View style={styles.medCardHeader}>
                <Text style={styles.medCardNum}>Medicamento {i + 1}</Text>
                <TouchableOpacity onPress={() => removeMed(i)}>
                  <Ionicons name="trash-outline" size={16} color={Colors.alert} />
                </TouchableOpacity>
              </View>
              <EditField label="Nombre *" value={m.medication_name} onChangeText={v => updateMed(i, 'medication_name', v)} />
              <View style={styles.row2}>
                <EditField label="Dosis" value={String(m.dose_amount ?? '')} onChangeText={v => updateMed(i, 'dose_amount', v)} keyboardType="numeric" flex />
                <EditField label="Unidad" value={m.dose_unit} onChangeText={v => updateMed(i, 'dose_unit', v)} flex />
              </View>
              <EditField label="Frecuencia" value={m.frequency_text} onChangeText={v => updateMed(i, 'frequency_text', v)} placeholder="Ej: Cada 8 horas" />
              <EditField label="Duración (días)" value={String(m.duration_days ?? '')} onChangeText={v => updateMed(i, 'duration_days', v)} keyboardType="numeric" />
              <EditField label="Instrucciones" value={m.instructions} onChangeText={v => updateMed(i, 'instructions', v)} multiline />
            </View>
          ))}
        </View>

        {/* Exámenes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Exámenes ({tests.length})</Text>
            <TouchableOpacity onPress={addTest} style={styles.addRowBtn}>
              <Ionicons name="add" size={18} color={Colors.primary} />
              <Text style={styles.addRowText}>Agregar</Text>
            </TouchableOpacity>
          </View>

          {tests.length === 0 && (
            <Text style={styles.emptyText}>Sin exámenes detectados. Toca "Agregar".</Text>
          )}

          {tests.map((t, i) => (
            <View key={i} style={styles.medCard}>
              <View style={styles.medCardHeader}>
                <Text style={styles.medCardNum}>Examen {i + 1}</Text>
                <TouchableOpacity onPress={() => removeTest(i)}>
                  <Ionicons name="trash-outline" size={16} color={Colors.alert} />
                </TouchableOpacity>
              </View>
              <EditField label="Nombre *" value={t.test_name} onChangeText={v => updateTest(i, 'test_name', v)} />
              <EditField label="Categoría" value={t.category} onChangeText={v => updateTest(i, 'category', v)} placeholder="Ej: laboratorio, imagen" />
              <EditField label="Indicaciones" value={t.instructions ?? ''} onChangeText={v => updateTest(i, 'instructions', v)} multiline />
            </View>
          ))}
        </View>

        {/* Confirmar */}
        {(() => {
          const hasEntries = meds.some(m => m.medication_name.trim()) || tests.some(t => t.test_name.trim());
          const allowEmptyConfirm = Boolean(errorMessage);
          return (
        <TouchableOpacity
          style={[styles.confirmBtn, (saving || (!hasEntries && !allowEmptyConfirm)) && { opacity: 0.6 }]}
          onPress={handleConfirm}
          disabled={saving || (!hasEntries && !allowEmptyConfirm)}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={Colors.white} />
            : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.white} />
                <Text style={styles.confirmBtnText}>
                  {errorMessage ? 'Guardar manualmente' : 'Guardar y generar recordatorios'}
                </Text>
              </View>
            )
          }
        </TouchableOpacity>
          );
        })()}

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function EditField({ label, value, onChangeText, placeholder, keyboardType, multiline, flex }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'numeric';
  multiline?: boolean; flex?: boolean;
}) {
  return (
    <View style={[styles.editField, flex && { flex: 1 }]}>
      <Text style={styles.editLabel}>{label}</Text>
      <TextInput
        style={[styles.editInput, multiline && { height: 64, textAlignVertical: 'top', paddingTop: 8 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        autoCorrect={false}
      />
    </View>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 38, height: 38, backgroundColor: Colors.surface, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { alignItems: 'center', gap: 3 },
  headerTitle: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  headerSub: { color: Colors.textSecondary, fontSize: Typography.sm },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  loadingTitle: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold, textAlign: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: Typography.base, textAlign: 'center', lineHeight: 22 },
  loadingHint: { color: Colors.textMuted, fontSize: Typography.xs },
  retryBtn: { height: 48, backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingHorizontal: Spacing.xl, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  retryText: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },

  content: { padding: Spacing.base, gap: Spacing.xl },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning + '55',
    padding: Spacing.md,
  },
  warningText: { color: Colors.textSecondary, fontSize: Typography.sm, flex: 1, lineHeight: 20 },

  section: { gap: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: Colors.textPrimary, fontSize: Typography.md, fontWeight: Typography.bold },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addRowText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  emptyText: { color: Colors.textMuted, fontSize: Typography.sm },

  medCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm,
  },
  medCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  medCardNum: { color: Colors.textSecondary, fontSize: Typography.xs, fontWeight: Typography.semibold, textTransform: 'uppercase' },

  row2: { flexDirection: 'row', gap: Spacing.sm },
  editField: { gap: 4 },
  editLabel: { color: Colors.textSecondary, fontSize: Typography.xs, fontWeight: Typography.medium },
  editInput: {
    backgroundColor: Colors.background, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.sm, height: 40,
    color: Colors.textPrimary, fontSize: Typography.sm,
  },

  testCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.infoBg },
  testName: { color: Colors.textPrimary, fontSize: Typography.sm, fontWeight: Typography.medium },
  testMeta: { color: Colors.textSecondary, fontSize: Typography.xs },

  confirmBtn: { height: 56, backgroundColor: Colors.healthy, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },

  visitBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.primary + '12',
    borderBottomWidth: 1, borderBottomColor: Colors.primary + '22',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
  },
  visitBadgeText: { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.medium },
});
