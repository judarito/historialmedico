import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../services/supabase';
import { useFamilyStore } from '../../store/familyStore';
import { useAuthStore } from '../../store/authStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { DatePickerField } from '../../components/ui/DatePickerField';
import { VoiceRecordButton } from '../../components/ui/VoiceRecordButton';
import { createCurrentDateTimeInput, toInputValue, toStoredIso } from '../../utils';

type VisitStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';

export default function AddVisitScreen() {
  const { memberId, memberName } = useLocalSearchParams<{
    memberId: string;
    memberName: string;
  }>();

  const { tenant, family } = useFamilyStore();
  const { user } = useAuthStore();

  // ── form state ────────────────────────────────────────────────────────
  const [visitDate, setVisitDate]             = useState(createCurrentDateTimeInput());
  const [doctorName, setDoctorName]           = useState('');
  const [specialty, setSpecialty]             = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [reasonForVisit, setReasonForVisit]   = useState('');
  const [diagnosis, setDiagnosis]             = useState('');
  const [notes, setNotes]                     = useState('');

  // vitals
  const [showVitals, setShowVitals]         = useState(false);
  const [weightKg, setWeightKg]             = useState('');
  const [heightCm, setHeightCm]             = useState('');
  const [temperatureC, setTemperatureC]     = useState('');
  const [bloodPressure, setBloodPressure]   = useState('');
  const [heartRate, setHeartRate]           = useState('');

  const [saving,        setSaving]        = useState(false);
  const [voiceLoading,  setVoiceLoading]  = useState(false);

  // ── voice ─────────────────────────────────────────────────────────────
  async function handleVoiceTranscription(transcription: string) {
    if (!transcription.trim()) return;
    setVoiceLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('voice-to-data', {
        body: { transcription, context: 'visit' },
      });

      if (error || !data) {
        Alert.alert('Error de voz', 'No se pudo procesar la nota de voz. Intenta de nuevo.');
        return;
      }

      // Pre-fill from transcription if no reason yet
      if (!reasonForVisit.trim()) {
        setReasonForVisit(transcription);
      }

      // Pre-fill from structured extraction
      const s = data.structured;
      if (s) {
        if (s.visit_date) {
          const nextVisitDate = toInputValue(s.visit_date, true);
          if (nextVisitDate) setVisitDate(nextVisitDate);
        }
        if (s.doctor_name)      setDoctorName(s.doctor_name);
        if (s.specialty)        setSpecialty(s.specialty);
        if (s.institution_name) setInstitutionName(s.institution_name);
        if (s.reason_for_visit) setReasonForVisit(s.reason_for_visit);
        if (s.diagnosis)        setDiagnosis(s.diagnosis);
        if (s.notes)            setNotes(s.notes);
        if (s.vitals) {
          const v = s.vitals;
          if (v.weight_kg     != null) { setWeightKg(String(v.weight_kg));        setShowVitals(true); }
          if (v.height_cm     != null) { setHeightCm(String(v.height_cm));        setShowVitals(true); }
          if (v.temperature_c != null) { setTemperatureC(String(v.temperature_c)); setShowVitals(true); }
          if (v.blood_pressure)        { setBloodPressure(v.blood_pressure);       setShowVitals(true); }
          if (v.heart_rate    != null) { setHeartRate(String(v.heart_rate));       setShowVitals(true); }
        }
      }

      Alert.alert('Datos cargados', 'Revisa y ajusta los campos si es necesario.');
    } catch (err) {
      console.error('add-visit voice error:', err);
      Alert.alert('Error', 'No se pudo procesar la nota de voz.');
    } finally {
      setVoiceLoading(false);
    }
  }

  // ── save ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!visitDate) {
      Alert.alert('Error', 'La fecha y hora de la visita es requerida.');
      return;
    }

    if (!tenant?.id || !family?.id) {
      Alert.alert('Error', 'No se encontró el grupo familiar activo.');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'No hay sesión de usuario activa.');
      return;
    }

    setSaving(true);

    const storedVisitDate = toStoredIso(visitDate, true);
    if (!storedVisitDate) {
      setSaving(false);
      Alert.alert('Error', 'La fecha de la visita no es válida.');
      return;
    }

    const visitStatus: VisitStatus = new Date(storedVisitDate).getTime() > Date.now()
      ? 'scheduled'
      : 'completed';

    const { error } = await supabase.from('medical_visits').insert({
      tenant_id:        tenant.id,
      family_id:        family.id,
      family_member_id: memberId,
      visit_date:       storedVisitDate,
      doctor_name:      doctorName.trim()        || null,
      specialty:        specialty.trim()         || null,
      institution_name: institutionName.trim()   || null,
      reason_for_visit: reasonForVisit.trim()    || null,
      diagnosis:        diagnosis.trim()         || null,
      notes:            notes.trim()             || null,
      weight_kg:        weightKg    ? parseFloat(weightKg)    : null,
      height_cm:        heightCm    ? parseFloat(heightCm)    : null,
      temperature_c:    temperatureC ? parseFloat(temperatureC) : null,
      blood_pressure:   bloodPressure.trim()     || null,
      heart_rate:       heartRate   ? parseFloat(heartRate)   : null,
      status:           visitStatus,
      created_by:       user.id,
    });

    setSaving(false);

    if (error) {
      Alert.alert('Error al guardar', error.message);
    } else {
      Alert.alert(
        visitStatus === 'scheduled' ? 'Cita programada' : 'Visita guardada',
        visitStatus === 'scheduled'
          ? 'La cita futura fue creada y el sistema podra recordartela.'
          : 'La visita fue registrada correctamente.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    }
  }

  // ── render ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Nueva Visita</Text>
          {!!memberName && (
            <Text style={styles.headerSub}>{memberName}</Text>
          )}
        </View>
        {voiceLoading
          ? <ActivityIndicator color={Colors.primary} style={{ marginRight: Spacing.xs }} />
          : (
            <VoiceRecordButton
              size={44}
              onTranscription={handleVoiceTranscription}
              disabled={saving}
            />
          )
        }
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Main fields ── */}
        <DatePickerField
          label="Fecha y hora *"
          value={visitDate}
          onChange={setVisitDate}
          withTime
        />
        <Text style={styles.helperText}>
          Si eliges una fecha futura, se guardara como cita programada y recibiras recordatorios.
        </Text>

        <Field label="Médico">
          <TextInput
            style={styles.input}
            value={doctorName}
            onChangeText={setDoctorName}
            placeholder="Nombre del médico"
            placeholderTextColor={Colors.textMuted}
          />
        </Field>

        <Field label="Especialidad">
          <TextInput
            style={styles.input}
            value={specialty}
            onChangeText={setSpecialty}
            placeholder="Ej: Medicina general, Pediatría..."
            placeholderTextColor={Colors.textMuted}
          />
        </Field>

        <Field label="Institución / Clínica">
          <TextInput
            style={styles.input}
            value={institutionName}
            onChangeText={setInstitutionName}
            placeholder="Nombre de la institución"
            placeholderTextColor={Colors.textMuted}
          />
        </Field>

        <Field label="Motivo de consulta">
          <TextInput
            style={styles.input}
            value={reasonForVisit}
            onChangeText={setReasonForVisit}
            placeholder="¿Por qué se realizó la visita?"
            placeholderTextColor={Colors.textMuted}
          />
        </Field>

        <Field label="Diagnóstico">
          <TextInput
            style={[styles.input, styles.multiline, { height: 80 }]}
            value={diagnosis}
            onChangeText={setDiagnosis}
            placeholder="Diagnóstico emitido por el médico"
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
          />
        </Field>

        <Field label="Observaciones">
          <TextInput
            style={[styles.input, styles.multiline, { height: 64 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notas adicionales"
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
          />
        </Field>

        {/* ── Vitals section ── */}
        <TouchableOpacity
          style={styles.vitalsToggle}
          onPress={() => setShowVitals(v => !v)}
          activeOpacity={0.75}
        >
          <Text style={styles.vitalsToggleLabel}>Signos Vitales</Text>
          <Text style={styles.vitalsToggleIcon}>{showVitals ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showVitals && (
          <View style={styles.vitalsContainer}>
            <Field label="Peso (kg)">
              <TextInput
                style={styles.input}
                value={weightKg}
                onChangeText={setWeightKg}
                placeholder="Ej: 68.5"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </Field>

            <Field label="Talla (cm)">
              <TextInput
                style={styles.input}
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="Ej: 170"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </Field>

            <Field label="Temperatura (°C)">
              <TextInput
                style={styles.input}
                value={temperatureC}
                onChangeText={setTemperatureC}
                placeholder="Ej: 36.5"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </Field>

            <Field label="Tensión arterial (ej: 120/80)">
              <TextInput
                style={styles.input}
                value={bloodPressure}
                onChangeText={setBloodPressure}
                placeholder="120/80"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />
            </Field>

            <Field label="Frecuencia cardíaca (lpm)">
              <TextInput
                style={styles.input}
                value={heartRate}
                onChangeText={setHeartRate}
                placeholder="Ej: 72"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </Field>
          </View>
        )}

        {/* ── Save button ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>Guardar visita</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Field wrapper ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  backBtn: {
    marginRight: Spacing.md,
    padding: Spacing.xs,
  },
  backArrow: {
    fontSize: Typography.xxl,
    color: Colors.primary,
    lineHeight: Typography.xxl + 2,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  headerSub: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },

  // Fields
  fieldContainer: {
    marginBottom: Spacing.base,
  },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  helperText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
    marginBottom: Spacing.base,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  multiline: {
    paddingTop: Spacing.md,
  },

  // Vitals toggle
  vitalsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vitalsToggleLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  vitalsToggleIcon: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  vitalsContainer: {
    marginBottom: Spacing.sm,
  },

  // Save button
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.base,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
});
