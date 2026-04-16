import React, { useEffect, useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../services/supabase';
import { MedicalDirectoryService, type MedicalDirectoryPlace } from '../../services/medicalDirectory';
import { useFamilyStore } from '../../store/familyStore';
import { useAuthStore } from '../../store/authStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { DatePickerField } from '../../components/ui/DatePickerField';
import { VoiceRecordButton } from '../../components/ui/VoiceRecordButton';
import { createCurrentDateTimeInput, toInputValue, toStoredIso } from '../../utils';

type VisitStatus = 'draft' | 'scheduled' | 'completed' | 'cancelled';

function createExpressFutureDateTimeInput(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return toInputValue(next.toISOString(), true) || createCurrentDateTimeInput();
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function AddVisitScreen() {
  const params = useLocalSearchParams<{
    memberId?: string | string[];
    memberName?: string | string[];
    doctorName?: string | string[];
    specialty?: string | string[];
    institutionName?: string | string[];
    sourcePlaceName?: string | string[];
    sourcePlaceKind?: string | string[];
    mode?: string | string[];
    defaultFuture?: string | string[];
    visitDate?: string | string[];
    reasonForVisit?: string | string[];
    diagnosis?: string | string[];
    notes?: string | string[];
    weightKg?: string | string[];
    heightCm?: string | string[];
    temperatureC?: string | string[];
    bloodPressure?: string | string[];
    heartRate?: string | string[];
    showOptionalDetails?: string | string[];
    showVitals?: string | string[];
  }>();

  const initialMemberId = typeof params.memberId === 'string' ? params.memberId : '';
  const initialMemberName = typeof params.memberName === 'string' ? params.memberName : '';
  const initialDoctorName = typeof params.doctorName === 'string' ? params.doctorName : '';
  const initialSpecialty = typeof params.specialty === 'string' ? params.specialty : '';
  const initialInstitutionName = typeof params.institutionName === 'string' ? params.institutionName : '';
  const sourcePlaceName = typeof params.sourcePlaceName === 'string' ? params.sourcePlaceName : '';
  const sourcePlaceKind = typeof params.sourcePlaceKind === 'string' ? params.sourcePlaceKind : '';
  const screenMode = typeof params.mode === 'string' ? params.mode : '';
  const defaultFuture = typeof params.defaultFuture === 'string' ? params.defaultFuture : '';
  const initialVisitDate = typeof params.visitDate === 'string' ? params.visitDate : '';
  const initialReasonForVisit = typeof params.reasonForVisit === 'string' ? params.reasonForVisit : '';
  const initialDiagnosis = typeof params.diagnosis === 'string' ? params.diagnosis : '';
  const initialNotes = typeof params.notes === 'string' ? params.notes : '';
  const initialWeightKg = typeof params.weightKg === 'string' ? params.weightKg : '';
  const initialHeightCm = typeof params.heightCm === 'string' ? params.heightCm : '';
  const initialTemperatureC = typeof params.temperatureC === 'string' ? params.temperatureC : '';
  const initialBloodPressure = typeof params.bloodPressure === 'string' ? params.bloodPressure : '';
  const initialHeartRate = typeof params.heartRate === 'string' ? params.heartRate : '';
  const isExpressSchedule = screenMode === 'schedule' || defaultFuture === '1';
  const initialShowOptionalDetails = typeof params.showOptionalDetails === 'string'
    ? params.showOptionalDetails !== '0'
    : !isExpressSchedule;
  const initialShowVitals = typeof params.showVitals === 'string'
    ? params.showVitals === '1'
    : false;

  const { tenant, family, members, fetchMembers } = useFamilyStore();
  const { user } = useAuthStore();

  // ── form state ────────────────────────────────────────────────────────
  const [selectedMemberId, setSelectedMemberId]   = useState(initialMemberId);
  const [visitDate, setVisitDate]             = useState(() => (
    initialVisitDate || (isExpressSchedule ? createExpressFutureDateTimeInput() : createCurrentDateTimeInput())
  ));
  const [doctorName, setDoctorName]           = useState(initialDoctorName);
  const [specialty, setSpecialty]             = useState(initialSpecialty);
  const [institutionName, setInstitutionName] = useState(initialInstitutionName);
  const [reasonForVisit, setReasonForVisit]   = useState(initialReasonForVisit);
  const [diagnosis, setDiagnosis]             = useState(initialDiagnosis);
  const [notes, setNotes]                     = useState(initialNotes);
  const [showOptionalDetails, setShowOptionalDetails] = useState(initialShowOptionalDetails);

  // vitals
  const [showVitals, setShowVitals]         = useState(initialShowVitals);
  const [weightKg, setWeightKg]             = useState(initialWeightKg);
  const [heightCm, setHeightCm]             = useState(initialHeightCm);
  const [temperatureC, setTemperatureC]     = useState(initialTemperatureC);
  const [bloodPressure, setBloodPressure]   = useState(initialBloodPressure);
  const [heartRate, setHeartRate]           = useState(initialHeartRate);

  const [saving,        setSaving]        = useState(false);
  const [voiceLoading,  setVoiceLoading]  = useState(false);
  const [favoritePlaces, setFavoritePlaces] = useState<MedicalDirectoryPlace[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [favoritesError, setFavoritesError] = useState('');
  const [showDoctorAutocomplete, setShowDoctorAutocomplete] = useState(false);
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const selectedMemberName = selectedMember?.first_name ?? initialMemberName;
  const needsMemberSelection = !initialMemberId;
  const isPrefilledFromDirectory = Boolean(initialDoctorName || initialSpecialty || initialInstitutionName || sourcePlaceName);
  const doctorNameQuery = normalizeSearchText(doctorName);
  const doctorNameMatches = favoritePlaces
    .filter((place) => {
      if (!doctorNameQuery) return true;
      const searchableBag = normalizeSearchText([
        place.display_name,
        place.formatted_address ?? '',
        place.primary_type ?? '',
      ].join(' '));
      return doctorNameQuery.split(' ').every((token) => searchableBag.includes(token));
    })
    .slice(0, 5);
  const doctorQuery = normalizeSearchText([doctorName, specialty, institutionName].filter(Boolean).join(' '));
  const suggestedFavorites = favoritePlaces
    .filter((place) => {
      if (!doctorQuery) return true;
      const searchableBag = normalizeSearchText([
        place.display_name,
        place.formatted_address ?? '',
        place.primary_type ?? '',
      ].join(' '));
      return doctorQuery.split(' ').every((token) => searchableBag.includes(token));
    })
    .slice(0, 6);

  useEffect(() => {
    if (family?.id && members.length === 0) {
      void fetchMembers();
    }
  }, [family?.id, members.length, fetchMembers]);

  useEffect(() => {
    void loadFavoritePlaces();
  }, []);

  useEffect(() => {
    if (!needsMemberSelection || selectedMemberId || members.length !== 1) return;
    setSelectedMemberId(members[0].id);
  }, [members, needsMemberSelection, selectedMemberId]);

  async function loadFavoritePlaces() {
    setLoadingFavorites(true);
    setFavoritesError('');
    try {
      const nextFavorites = await MedicalDirectoryService.listFavoritePlaces();
      setFavoritePlaces(nextFavorites);
    } catch (error) {
      setFavoritesError(error instanceof Error ? error.message : 'No se pudieron cargar los favoritos del directorio');
    } finally {
      setLoadingFavorites(false);
    }
  }

  function applyFavoritePlace(place: MedicalDirectoryPlace) {
    setDoctorName(place.display_name);
    if (!institutionName.trim() && place.place_kind && place.place_kind !== 'specialist') {
      setInstitutionName(place.display_name);
    }
    setShowDoctorAutocomplete(false);
  }

  function openDirectorySearch() {
    router.push({
      pathname: '/(app)/doctor-directory',
      params: {
        memberId: selectedMemberId || initialMemberId,
        memberName: selectedMemberName,
        mode: screenMode,
        defaultFuture,
        visitDate,
        doctorName,
        specialty,
        institutionName,
        reasonForVisit,
        diagnosis,
        notes,
        weightKg,
        heightCm,
        temperatureC,
        bloodPressure,
        heartRate,
        showOptionalDetails: showOptionalDetails ? '1' : '0',
        showVitals: showVitals ? '1' : '0',
      },
    });
  }

  function resetFormState() {
    setSelectedMemberId(initialMemberId || (needsMemberSelection && members.length === 1 ? members[0].id : ''));
    setVisitDate(initialVisitDate || (isExpressSchedule ? createExpressFutureDateTimeInput() : createCurrentDateTimeInput()));
    setDoctorName(initialDoctorName);
    setSpecialty(initialSpecialty);
    setInstitutionName(initialInstitutionName);
    setReasonForVisit(initialReasonForVisit);
    setDiagnosis(initialDiagnosis);
    setNotes(initialNotes);
    setShowOptionalDetails(initialShowOptionalDetails);
    setShowVitals(initialShowVitals);
    setWeightKg(initialWeightKg);
    setHeightCm(initialHeightCm);
    setTemperatureC(initialTemperatureC);
    setBloodPressure(initialBloodPressure);
    setHeartRate(initialHeartRate);
  }

  function completeSave(visitStatus: VisitStatus) {
    const title = visitStatus === 'scheduled' ? 'Cita programada' : 'Visita guardada';
    const message = visitStatus === 'scheduled'
      ? 'La cita futura fue creada y el sistema podra recordartela.'
      : 'La visita fue registrada correctamente.';

    if (isExpressSchedule && visitStatus === 'scheduled') {
      resetFormState();
      if (Platform.OS === 'web') {
        globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
      }
      router.replace('/(app)/appointments');
      return;
    }

    if (Platform.OS === 'web') {
      globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
      resetFormState();
      router.back();
      return;
    }

    Alert.alert(title, message, [
      {
        text: isExpressSchedule && visitStatus === 'scheduled' ? 'Ver agenda' : 'OK',
        onPress: () => {
          resetFormState();
          if (isExpressSchedule && visitStatus === 'scheduled') {
            router.replace('/(app)/appointments');
            return;
          }
          router.back();
        },
      },
    ]);
  }

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

    if (!selectedMemberId) {
      Alert.alert('Error', 'Selecciona a qué familiar corresponde esta visita.');
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
      family_member_id: selectedMemberId,
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
      completeSave(visitStatus);
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
          <Text style={styles.headerTitle}>{isExpressSchedule ? 'Nueva cita express' : 'Nueva Visita'}</Text>
          {!!selectedMemberName && (
            <Text style={styles.headerSub}>{selectedMemberName}</Text>
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

      <KeyboardAvoidingView
        style={styles.formWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
          {isExpressSchedule
            ? 'Te sugerimos una cita futura por defecto para que la agendes en pocos toques. Puedes cambiarla antes de guardar.'
            : 'Si eliges una fecha futura, se guardara como cita programada y recibiras recordatorios.'}
        </Text>

        {needsMemberSelection && (
          <>
            <Field label="Familiar *">
              {members.length === 0 ? (
                <View style={styles.memberState}>
                  <ActivityIndicator color={Colors.primary} size="small" />
                  <Text style={styles.memberStateText}>Cargando familiares...</Text>
                </View>
              ) : (
                <View style={styles.memberChipList}>
                  {members.map((member) => {
                    const fullName = `${member.first_name} ${member.last_name ?? ''}`.trim();
                    const active = selectedMemberId === member.id;
                    return (
                      <TouchableOpacity
                        key={member.id}
                        style={[styles.memberChip, active && styles.memberChipActive]}
                        onPress={() => setSelectedMemberId(member.id)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.memberChipText, active && styles.memberChipTextActive]}>
                          {fullName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </Field>
            <Text style={styles.helperText}>
              Elige a quién corresponde esta visita antes de guardarla.
            </Text>
          </>
        )}

        {isPrefilledFromDirectory && (
          <View style={styles.directoryHint}>
            <Text style={styles.directoryHintTitle}>Datos precargados desde el directorio</Text>
            <Text style={styles.directoryHintText}>
              {sourcePlaceName
                ? `Tomamos datos iniciales de "${sourcePlaceName}"${sourcePlaceKind ? ` (${sourcePlaceKind})` : ''}. Ajústalos si hace falta antes de guardar.`
                : 'Tomamos datos iniciales del especialista o lugar elegido. Ajústalos si hace falta antes de guardar.'}
            </Text>
          </View>
        )}

        <Field label="Médico">
          <View style={styles.autocompleteWrap}>
            <TextInput
              style={styles.input}
              value={doctorName}
              onChangeText={(value) => {
                setDoctorName(value);
                setShowDoctorAutocomplete(true);
              }}
              onFocus={() => setShowDoctorAutocomplete(true)}
              onBlur={() => {
                setTimeout(() => setShowDoctorAutocomplete(false), 120);
              }}
              placeholder="Nombre del médico"
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              autoCapitalize="words"
            />

            {showDoctorAutocomplete && !loadingFavorites && doctorNameMatches.length > 0 && (
              <View style={styles.autocompleteList}>
                {doctorNameMatches.map((place) => (
                  <TouchableOpacity
                    key={place.id}
                    style={styles.autocompleteItem}
                    onPress={() => applyFavoritePlace(place)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.autocompleteTitle}>{place.display_name}</Text>
                    {!!place.formatted_address && (
                      <Text style={styles.autocompleteMeta} numberOfLines={1}>
                        {place.formatted_address}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </Field>

        <View style={styles.directoryAssistCard}>
          <View style={styles.directoryAssistHeader}>
            <View style={styles.directoryAssistCopy}>
              <Text style={styles.directoryAssistTitle}>Autocompletar desde favoritos</Text>
              <Text style={styles.directoryAssistText}>
                Usa especialistas o lugares guardados. Si no está aquí, abre la búsqueda del directorio.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.directoryAssistAction}
              onPress={openDirectorySearch}
              activeOpacity={0.8}
            >
              <Text style={styles.directoryAssistActionText}>Buscar</Text>
            </TouchableOpacity>
          </View>

          {loadingFavorites ? (
            <View style={styles.favoriteStateRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.favoriteStateText}>Cargando favoritos...</Text>
            </View>
          ) : favoritesError ? (
            <Text style={styles.favoriteErrorText}>{favoritesError}</Text>
          ) : favoritePlaces.length === 0 ? (
            <Text style={styles.favoriteStateText}>
              Aún no tienes favoritos guardados. Puedes buscar un médico o clínica en el directorio.
            </Text>
          ) : suggestedFavorites.length === 0 ? (
            <Text style={styles.favoriteStateText}>
              No encontramos coincidencias en tus favoritos con lo que llevas escrito.
            </Text>
          ) : (
            <View style={styles.favoriteChipList}>
              {suggestedFavorites.map((place) => {
                const active = doctorName.trim() === place.display_name.trim();
                return (
                  <TouchableOpacity
                    key={place.id}
                    style={[styles.favoriteChip, active && styles.favoriteChipActive]}
                    onPress={() => applyFavoritePlace(place)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.favoriteChipTitle, active && styles.favoriteChipTitleActive]}>
                      {place.display_name}
                    </Text>
                    {!!place.formatted_address && (
                      <Text
                        style={[styles.favoriteChipMeta, active && styles.favoriteChipMetaActive]}
                        numberOfLines={1}
                      >
                        {place.formatted_address}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

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
            placeholder={isExpressSchedule ? '¿Para qué es la cita?' : '¿Por qué se realizó la visita?'}
            placeholderTextColor={Colors.textMuted}
          />
        </Field>

        <TouchableOpacity
          style={styles.optionalToggle}
          onPress={() => setShowOptionalDetails((value) => !value)}
          activeOpacity={0.75}
        >
          <View style={styles.optionalToggleCopy}>
            <Text style={styles.optionalToggleTitle}>Detalles opcionales</Text>
            <Text style={styles.optionalToggleHint}>
              {isExpressSchedule
                ? 'Diagnóstico, observaciones y signos vitales se pueden completar después.'
                : 'Abre esta sección si quieres registrar más contexto clínico.'}
            </Text>
          </View>
          <Text style={styles.vitalsToggleIcon}>{showOptionalDetails ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showOptionalDetails && (
          <>
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
          </>
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
            <Text style={styles.saveBtnText}>{isExpressSchedule ? 'Programar cita' : 'Guardar visita'}</Text>
          )}
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
  formWrapper: {
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
  memberState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
  },
  memberStateText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  memberChipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  memberChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memberChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  memberChipText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  memberChipTextActive: {
    color: Colors.white,
  },
  directoryHint: {
    gap: Spacing.xs,
    backgroundColor: Colors.infoBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.info + '22',
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  directoryHintTitle: {
    color: Colors.info,
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
  directoryHintText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  autocompleteWrap: {
    position: 'relative',
  },
  autocompleteList: {
    marginTop: Spacing.xs,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  autocompleteItem: {
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 2,
  },
  autocompleteTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  autocompleteMeta: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  directoryAssistCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    gap: Spacing.sm,
    marginBottom: Spacing.base,
  },
  directoryAssistHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  directoryAssistCopy: {
    flex: 1,
    gap: 4,
  },
  directoryAssistTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  directoryAssistText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 18,
  },
  directoryAssistAction: {
    backgroundColor: Colors.primary + '18',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  directoryAssistActionText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  favoriteStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  favoriteStateText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  favoriteErrorText: {
    color: Colors.warning,
    fontSize: Typography.sm,
    lineHeight: 18,
  },
  favoriteChipList: {
    gap: Spacing.sm,
  },
  favoriteChip: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  favoriteChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '14',
  },
  favoriteChipTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  favoriteChipTitleActive: {
    color: Colors.primary,
  },
  favoriteChipMeta: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  favoriteChipMetaActive: {
    color: Colors.textSecondary,
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
  optionalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionalToggleCopy: {
    flex: 1,
    gap: 4,
  },
  optionalToggleTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  optionalToggleHint: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 18,
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
