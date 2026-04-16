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
  Modal,
  Image,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { supabase } from '../../../services/supabase';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../theme';
import type { Database } from '../../../types/database.types';
import {
  buildMedicalVisitUpdate,
  formatCalendarDate,
  getVisitReviewItems,
  getVitalsReviewItems,
  normalizeExtractedVisitData,
  toInputValue,
  toStoredIso,
} from '../../../utils';
import { DatePickerField } from '../../../components/ui/DatePickerField';
import { VoiceRecordButton, type VoiceCapturePayload } from '../../../components/ui/VoiceRecordButton';

type MedicalVisit   = Database['public']['Tables']['medical_visits']['Row'];
type MedicalDocument = Database['public']['Tables']['medical_documents']['Row'];
type Prescription = Database['public']['Tables']['prescriptions']['Row'];
type MedicalTest = Database['public']['Tables']['medical_tests']['Row'];
type VisitStatus = Database['public']['Tables']['medical_visits']['Row']['status'];
type DeleteAttachmentResult = {
  file_path?: string | null;
  detached_prescriptions?: number | null;
  detached_tests?: number | null;
  preserved_clinical_data?: boolean | null;
};

type CascadeDeleteResult = {
  file_paths?: string[] | null;
  deleted_documents?: number | null;
  deleted_prescriptions?: number | null;
  deleted_schedules?: number | null;
  deleted_tests?: number | null;
  deleted_reminders?: number | null;
};

type VoiceExtractedMedication = {
  medication_name?: string | null;
  dose_amount?: number | string | null;
  dose_unit?: string | null;
  frequency_text?: string | null;
  interval_hours?: number | string | null;
  duration_days?: number | string | null;
  route?: string | null;
  instructions?: string | null;
};

type VoiceExtractedTest = {
  test_name?: string | null;
  category?: string | null;
  instructions?: string | null;
};

type VoiceExtractedTherapy = {
  therapy_name?: string | null;
  frequency_text?: string | null;
  duration_days?: number | string | null;
  instructions?: string | null;
};

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
  voice_note:   'Nota de voz',
  other:        'Documento',
};

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|heic|webp)$/i;
const AUDIO_EXT_RE = /\.(m4a|mp3|aac|wav|ogg|webm)$/i;

function isImageDocument(doc: MedicalDocument): boolean {
  return Boolean(doc.mime_type?.startsWith('image/')) || IMAGE_EXT_RE.test(doc.file_path ?? '');
}

function isAudioDocument(doc: MedicalDocument): boolean {
  return Boolean(doc.mime_type?.startsWith('audio/')) || AUDIO_EXT_RE.test(doc.file_path ?? '');
}

function getDocumentLabel(doc: MedicalDocument): string {
  return doc.title || DOC_TYPE_LABEL[doc.document_type ?? ''] || 'Documento';
}

function getDocumentIcon(doc: MedicalDocument): keyof typeof Ionicons.glyphMap {
  if (isAudioDocument(doc)) return 'mic-outline';
  if (isImageDocument(doc)) return 'image-outline';
  return 'document-attach-outline';
}

function getDocumentReferenceDate(doc: MedicalDocument): string | null {
  return doc.captured_at ?? doc.created_at;
}

function compareDocumentsByReferenceDate(a: MedicalDocument, b: MedicalDocument): number {
  const aTime = new Date(getDocumentReferenceDate(a) ?? a.created_at).getTime();
  const bTime = new Date(getDocumentReferenceDate(b) ?? b.created_at).getTime();
  return bTime - aTime;
}

function formatAudioTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') {
    globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
    return;
  }

  Alert.alert(title, message);
}

function showConfirm(params: {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmStyle?: 'default' | 'destructive';
  onConfirm: () => void;
}) {
  const { title, message, confirmLabel = 'Aceptar', confirmStyle = 'destructive', onConfirm } = params;

  if (Platform.OS === 'web') {
    const accepted = globalThis.confirm?.([title, message].filter(Boolean).join('\n\n')) ?? false;
    if (accepted) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: confirmStyle, onPress: onConfirm },
  ]);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mergeTextBlocks(...values: Array<string | null | undefined>): string | null {
  const unique = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index) as string[];

  return unique.length > 0 ? unique.join('\n\n') : null;
}

function normalizeVoiceMedications(value: unknown): VoiceExtractedMedication[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is VoiceExtractedMedication => Boolean(normalizeText((item as VoiceExtractedMedication)?.medication_name)));
}

function normalizeVoiceTests(value: unknown): VoiceExtractedTest[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is VoiceExtractedTest => Boolean(normalizeText((item as VoiceExtractedTest)?.test_name)));
}

function normalizeVoiceTherapies(value: unknown): VoiceExtractedTherapy[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is VoiceExtractedTherapy => Boolean(normalizeText((item as VoiceExtractedTherapy)?.therapy_name)));
}

function buildTherapiesSummary(therapies: VoiceExtractedTherapy[]): string | null {
  if (therapies.length === 0) return null;

  const lines = therapies.map((therapy) => {
    const parts = [
      normalizeText(therapy.therapy_name),
      normalizeText(therapy.frequency_text),
      therapy.duration_days ? `${therapy.duration_days} día(s)` : null,
      normalizeText(therapy.instructions),
    ].filter(Boolean);

    return parts.join(' · ');
  }).filter(Boolean);

  return lines.length > 0 ? `Terapias / recomendaciones terapéuticas:\n- ${lines.join('\n- ')}` : null;
}

function isMissingRpc(error: { message?: string | null; details?: string | null } | null): boolean {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase();
  return (
    haystack.includes('delete_medical_document_attachment') ||
    haystack.includes('delete_medical_document_with_dependencies') ||
    haystack.includes('delete_medical_visit_cascade') ||
    haystack.includes('soft_delete_medical_visit')
  ) && (
    haystack.includes('does not exist') ||
    haystack.includes('schema cache') ||
    haystack.includes('could not find')
  );
}

export default function VisitDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [visit,     setVisit]     = useState<MedicalVisit | null>(null);
  const [visitMemberName, setVisitMemberName] = useState<string | null>(null);
  const [docs,      setDocs]      = useState<MedicalDocument[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [tests, setTests] = useState<MedicalTest[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [previewDoc, setPreviewDoc] = useState<MedicalDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [audioSound, setAudioSound] = useState<Audio.Sound | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioPositionMillis, setAudioPositionMillis] = useState(0);
  const [audioDurationMillis, setAudioDurationMillis] = useState(0);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deletingVisit, setDeletingVisit] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<VisitStatus | null>(null);
  const [updatingPrescriptionId, setUpdatingPrescriptionId] = useState<string | null>(null);
  const [updatingTestId, setUpdatingTestId] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editVisitDate, setEditVisitDate] = useState('');
  const [editReasonForVisit, setEditReasonForVisit] = useState('');
  const [editSymptoms, setEditSymptoms] = useState('');
  const [editDiagnosis, setEditDiagnosis] = useState('');
  const [savingVisitEdit, setSavingVisitEdit] = useState(false);
  const [inferringDiagnosis, setInferringDiagnosis] = useState(false);
  const [processingDoctorVoice, setProcessingDoctorVoice] = useState(false);
  const [savingDoctorVoice, setSavingDoctorVoice] = useState(false);
  const [doctorVoiceModalVisible, setDoctorVoiceModalVisible] = useState(false);
  const [doctorVoiceTranscript, setDoctorVoiceTranscript] = useState('');
  const [doctorVoiceAudioUri, setDoctorVoiceAudioUri] = useState<string | null>(null);
  const [doctorVoiceStructured, setDoctorVoiceStructured] = useState<Record<string, unknown> | null>(null);

  // Recargar al volver del scan (después de adjuntar un documento)
  useFocusEffect(useCallback(() => { load(); }, [id]));

  useEffect(() => {
    return () => {
      if (audioSound) {
        audioSound.unloadAsync().catch(() => {});
      }
    };
  }, [audioSound]);

  async function load() {
    if (!id) return;
    setVisitMemberName(null);
    const [visitRes, docsRes, prescriptionsRes, testsRes] = await Promise.all([
      supabase.from('medical_visits').select('*').eq('id', id).is('deleted_at', null).single(),
      supabase
        .from('medical_documents')
        .select('*')
        .eq('medical_visit_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('*')
        .eq('medical_visit_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('medical_tests')
        .select('*')
        .eq('medical_visit_id', id)
        .order('created_at', { ascending: false }),
    ]);
    if (visitRes.data) {
      setVisit(visitRes.data);

      const { data: memberData } = await supabase
        .from('family_members')
        .select('first_name, last_name')
        .eq('id', visitRes.data.family_member_id)
        .single();

      const fullName = [memberData?.first_name, memberData?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

      setVisitMemberName(fullName || null);
    } else {
      setVisitMemberName(null);
    }
    setDocs([...(docsRes.data ?? [])].sort(compareDocumentsByReferenceDate));
    setPrescriptions(prescriptionsRes.data ?? []);
    setTests(testsRes.data ?? []);
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

  function openEditVisitModal() {
    if (!visit) return;

    setEditVisitDate(toInputValue(visit.visit_date, true) ?? '');
    setEditReasonForVisit(visit.reason_for_visit ?? '');
    setEditSymptoms(visit.notes ?? '');
    setEditDiagnosis(visit.diagnosis ?? '');
    setEditModalVisible(true);
  }

  function closeEditVisitModal() {
    if (savingVisitEdit || inferringDiagnosis) return;
    setEditModalVisible(false);
  }

  function resetDoctorVoiceDraft() {
    setDoctorVoiceTranscript('');
    setDoctorVoiceAudioUri(null);
    setDoctorVoiceStructured(null);
  }

  function closeDoctorVoiceModal() {
    if (processingDoctorVoice || savingDoctorVoice) return;
    setDoctorVoiceModalVisible(false);
    resetDoctorVoiceDraft();
  }

  async function handleDoctorVoiceCapture(payload: VoiceCapturePayload) {
    const transcript = payload.transcription.trim();
    if (!transcript) {
      showAlert('Sin transcripción', 'No logramos convertir la voz en texto. Intenta de nuevo más cerca del médico o con menos ruido.');
      return;
    }

    setProcessingDoctorVoice(true);
    try {
      const { data, error } = await supabase.functions.invoke('voice-to-data', {
        body: { transcription: transcript, context: 'visit' },
      });

      if (error || !data) {
        showAlert('No se pudo procesar', error?.message ?? 'La nota de voz no pudo analizarse.');
        return;
      }

      setDoctorVoiceTranscript(transcript);
      setDoctorVoiceAudioUri(payload.audioUri);
      setDoctorVoiceStructured((data.structured as Record<string, unknown> | null) ?? null);
      setDoctorVoiceModalVisible(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo procesar la nota de voz.';
      showAlert('No se pudo procesar', message);
    } finally {
      setProcessingDoctorVoice(false);
    }
  }

  async function saveDoctorVoiceCapture() {
    if (!visit) return;

    setSavingDoctorVoice(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw new Error('No hay una sesión activa para guardar esta nota de voz.');
      }

      let audioFilePath = '';
      let audioMimeType: string | null = null;
      let audioSizeBytes: number | null = null;

      if (doctorVoiceAudioUri) {
        const extensionMatch = doctorVoiceAudioUri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
        const extension = (extensionMatch?.[1] ?? 'm4a').toLowerCase();
        audioMimeType = extension === 'webm' ? 'audio/webm' : 'audio/mp4';
        audioFilePath = `${visit.tenant_id}/${visit.family_id}/${visit.family_member_id}/voice-visit-${visit.id}-${Date.now()}.${extension}`;

        const response = await fetch(doctorVoiceAudioUri);
        const arrayBuffer = await response.arrayBuffer();
        audioSizeBytes = arrayBuffer.byteLength;

        const { error: uploadError } = await supabase.storage
          .from('medical-documents')
          .upload(audioFilePath, new Uint8Array(arrayBuffer), {
            contentType: audioMimeType,
            upsert: false,
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }
      }

      const normalizedVisitData = normalizeExtractedVisitData(doctorVoiceStructured as Record<string, unknown> | null);
      const voiceMedications = normalizeVoiceMedications(doctorVoiceStructured?.medications);
      const voiceTests = normalizeVoiceTests(doctorVoiceStructured?.tests);
      const voiceTherapies = normalizeVoiceTherapies(doctorVoiceStructured?.therapies);
      const therapiesSummary = buildTherapiesSummary(voiceTherapies);
      const visitUpdates = buildMedicalVisitUpdate(normalizedVisitData, { includeVisitDate: false });
      const mergedNotes = mergeTextBlocks(visit.notes, normalizedVisitData.notes, therapiesSummary);
      const mergedVoiceText = mergeTextBlocks(visit.voice_note_text, doctorVoiceTranscript);
      const recordedAt = new Date().toISOString();

      const { error: visitError } = await supabase
        .from('medical_visits')
        .update({
          ...visitUpdates,
          notes: mergedNotes,
          voice_note_text: mergedVoiceText,
        })
        .eq('id', visit.id);

      if (visitError) {
        throw new Error(visitError.message);
      }

      const { data: documentData, error: documentError } = await supabase
        .from('medical_documents')
        .insert({
          tenant_id: visit.tenant_id,
          family_id: visit.family_id,
          family_member_id: visit.family_member_id,
          medical_visit_id: visit.id,
          document_type: 'voice_note',
          title: `Nota del médico ${formatCalendarDate(visit.visit_date)}`,
          file_path: audioFilePath,
          mime_type: audioMimeType,
          file_size_bytes: audioSizeBytes,
          captured_at: recordedAt,
          extracted_text: doctorVoiceTranscript,
          parsed_json: doctorVoiceStructured ?? null,
          ai_model: 'deepseek-chat',
          processing_status: 'processed',
          verified_by_user: true,
          created_by: authData.user.id,
        })
        .select('id')
        .single();

      if (documentError || !documentData?.id) {
        throw new Error(documentError?.message ?? 'No se pudo crear el adjunto de voz.');
      }

      if (voiceMedications.length > 0 || voiceTests.length > 0) {
        const { error: confirmError } = await supabase.rpc('confirm_document_and_create_records', {
          p_document_id: documentData.id,
          p_medications: voiceMedications as unknown as Database['public']['Functions']['confirm_document_and_create_records']['Args']['p_medications'],
          p_tests: voiceTests as unknown as Database['public']['Functions']['confirm_document_and_create_records']['Args']['p_tests'],
        });

        if (confirmError) {
          throw new Error(confirmError.message);
        }
      }

      setDoctorVoiceModalVisible(false);
      resetDoctorVoiceDraft();
      await load();

      const summaryParts = [
        'La observación por voz quedó vinculada a la visita.',
        voiceMedications.length > 0 ? `Medicamentos creados: ${voiceMedications.length}.` : null,
        voiceTests.length > 0 ? `Exámenes creados: ${voiceTests.length}.` : null,
        voiceTherapies.length > 0 ? 'Las terapias quedaron resumidas en observaciones.' : null,
      ].filter(Boolean);

      showAlert('Nota del médico guardada', summaryParts.join(' '));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la nota del médico.';
      showAlert('No se pudo guardar', message);
    } finally {
      setSavingDoctorVoice(false);
    }
  }

  async function inferDiagnosisWithAI() {
    if (!visit) return;

    setInferringDiagnosis(true);
    try {
      const { data, error } = await supabase.functions.invoke('infer-visit-diagnosis', {
        body: {
          visit: {
            doctor_name: visit.doctor_name,
            specialty: visit.specialty,
            institution_name: visit.institution_name,
            reason_for_visit: editReasonForVisit.trim() || visit.reason_for_visit,
            diagnosis: editDiagnosis.trim() || visit.diagnosis,
            notes: editSymptoms.trim() || visit.notes,
            vitals: {
              weight_kg: visit.weight_kg,
              height_cm: visit.height_cm,
              temperature_c: visit.temperature_c,
              blood_pressure: visit.blood_pressure,
              heart_rate: visit.heart_rate,
            },
          },
          prescriptions: prescriptions.map((item) => ({
            medication_name: item.medication_name,
            presentation: item.presentation,
            dose_amount: item.dose_amount,
            dose_unit: item.dose_unit,
            frequency_text: item.frequency_text,
            route: item.route,
            instructions: item.instructions,
          })),
          tests: tests.map((item) => ({
            test_name: item.test_name,
            category: item.category,
            notes: item.notes,
          })),
        },
      });

      if (error) {
        showAlert('No se pudo inferir', error.message);
        return;
      }

      const suggestedDiagnosis = typeof data?.diagnosis === 'string'
        ? data.diagnosis.trim()
        : '';

      if (!suggestedDiagnosis) {
        showAlert('Sin sugerencia', 'La IA no encontró suficiente contexto para proponer un diagnóstico confiable.');
        return;
      }

      setEditDiagnosis(suggestedDiagnosis);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo inferir el diagnóstico.';
      showAlert('No se pudo inferir', message);
    } finally {
      setInferringDiagnosis(false);
    }
  }

  async function saveVisitEdit() {
    if (!visit) return;

    const canEditVisitDate = visit.status === 'scheduled';
    const canEditDiagnosis = visit.status !== 'scheduled';
    const updates: Database['public']['Tables']['medical_visits']['Update'] = {};
    const normalizedReason = editReasonForVisit.trim();
    const normalizedSymptoms = editSymptoms.trim();
    const currentReason = (visit.reason_for_visit ?? '').trim();
    const currentSymptoms = (visit.notes ?? '').trim();

    if (canEditVisitDate) {
      if (!editVisitDate) {
        showAlert('Fecha requerida', 'Selecciona la nueva fecha de la cita.');
        return;
      }

      const storedVisitDate = toStoredIso(editVisitDate, true);
      if (!storedVisitDate) {
        showAlert('Fecha inválida', 'La nueva fecha de la cita no es válida.');
        return;
      }

      if (new Date(storedVisitDate).getTime() <= Date.now()) {
        showAlert('Fecha inválida', 'La cita debe mantenerse en una fecha futura.');
        return;
      }

      updates.visit_date = storedVisitDate;
    }

    if (canEditDiagnosis) {
      const trimmedDiagnosis = editDiagnosis.trim();
      const currentDiagnosis = (visit.diagnosis ?? '').trim();
      if (!trimmedDiagnosis && currentDiagnosis) {
        showAlert('Diagnóstico requerido', 'Si quieres cambiarlo, escribe un diagnóstico o usa "Inferir con IA".');
        return;
      }
      if (trimmedDiagnosis && trimmedDiagnosis !== currentDiagnosis) {
        updates.diagnosis = trimmedDiagnosis;
      }
    }

    if (normalizedReason !== currentReason) {
      updates.reason_for_visit = normalizedReason || null;
    }

    if (normalizedSymptoms !== currentSymptoms) {
      updates.notes = normalizedSymptoms || null;
    }

    if (Object.keys(updates).length === 0) {
      setEditModalVisible(false);
      return;
    }

    setSavingVisitEdit(true);
    try {
      const { error } = await supabase
        .from('medical_visits')
        .update(updates)
        .eq('id', visit.id);

      if (error) {
        showAlert('No se pudo actualizar', error.message);
        return;
      }

      setVisit((current) => current ? { ...current, ...updates } : current);
      setEditModalVisible(false);
      showAlert('Visita actualizada', canEditVisitDate
        ? 'La cita fue actualizada. Si cambiaste la fecha, sus recordatorios se sincronizarán automáticamente.'
        : 'Los cambios de la visita fueron guardados.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar la visita.';
      showAlert('No se pudo actualizar', message);
    } finally {
      setSavingVisitEdit(false);
    }
  }

  function openMemberMedicationTimeline() {
    if (!visit) return;
    router.push({
      pathname: '/(app)/(tabs)/medications',
      params: {
        memberId: visit.family_member_id,
      },
    });
  }

  async function updateVisitStatus(nextStatus: VisitStatus) {
    if (!visit) return;

    setUpdatingStatus(nextStatus);
    try {
      const { error } = await supabase
        .from('medical_visits')
        .update({ status: nextStatus })
        .eq('id', visit.id);

      if (error) {
        showAlert('No se pudo actualizar', error.message);
        return;
      }

      setVisit((current) => current ? { ...current, status: nextStatus } : current);
    } finally {
      setUpdatingStatus(null);
    }
  }

  function confirmCompleteVisit() {
    showConfirm({
      title: 'Marcar como realizada',
      message: 'La cita pasara al historial como visita completada y se limpiaran recordatorios futuros pendientes.',
      confirmLabel: 'Marcar',
      confirmStyle: 'default',
      onConfirm: () => { void updateVisitStatus('completed'); },
    });
  }

  function confirmCancelVisit() {
    showConfirm({
      title: 'Cancelar cita',
      message: 'La cita se marcara como cancelada y dejaran de salir recordatorios pendientes.',
      confirmLabel: 'Cancelar cita',
      onConfirm: () => { void updateVisitStatus('cancelled'); },
    });
  }

  function confirmCompletePrescription(prescription: Prescription) {
    showConfirm({
      title: 'Completar tratamiento',
      message: 'El medicamento dejará de aparecer como activo y sus dosis pendientes futuras se cancelarán.',
      confirmLabel: 'Completar',
      confirmStyle: 'default',
      onConfirm: () => { void completePrescription(prescription); },
    });
  }

  async function completePrescription(prescription: Prescription) {
    setUpdatingPrescriptionId(prescription.id);
    try {
      const completedAt = new Date().toISOString();
      const [{ error: prescriptionError }, { error: schedulesError }] = await Promise.all([
        supabase
          .from('prescriptions')
          .update({
            status: 'completed',
            end_at: completedAt,
          })
          .eq('id', prescription.id),
        supabase
          .from('medication_schedules')
          .update({ status: 'cancelled' })
          .eq('prescription_id', prescription.id)
          .in('status', ['pending', 'late']),
      ]);

      if (prescriptionError || schedulesError) {
        throw prescriptionError ?? schedulesError;
      }

      setPrescriptions((current) => current.map((item) => (
        item.id === prescription.id
          ? { ...item, status: 'completed', end_at: completedAt }
          : item
      )));

      showAlert(
        'Tratamiento completado',
        'El medicamento ya no aparecerá como activo y sus dosis pendientes futuras se cancelaron.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar el tratamiento.';
      showAlert('No se pudo actualizar', message);
    } finally {
      setUpdatingPrescriptionId(null);
    }
  }

  function confirmCompleteTest(test: MedicalTest) {
    showConfirm({
      title: 'Marcar examen como realizado',
      message: 'El examen pasará a completado y dejará de aparecer como pendiente en la familia.',
      confirmLabel: 'Marcar',
      confirmStyle: 'default',
      onConfirm: () => { void completeTest(test); },
    });
  }

  async function completeTest(test: MedicalTest) {
    setUpdatingTestId(test.id);
    try {
      const completedAt = new Date().toISOString();
      const [{ error: testError }, { error: reminderError }] = await Promise.all([
        supabase
          .from('medical_tests')
          .update({
            status: 'completed',
            completed_at: completedAt,
          })
          .eq('id', test.id),
        supabase
          .from('reminders')
          .update({
            status: 'dismissed',
            read_at: completedAt,
          })
          .eq('medical_test_id', test.id)
          .in('status', ['pending', 'sent', 'read', 'failed']),
      ]);

      if (testError || reminderError) {
        throw testError ?? reminderError;
      }

      setTests((current) => current.map((item) => (
        item.id === test.id
          ? { ...item, status: 'completed', completed_at: completedAt }
          : item
      )));

      showAlert('Examen actualizado', 'El examen quedó marcado como realizado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el examen.';
      showAlert('No se pudo actualizar', message);
    } finally {
      setUpdatingTestId(null);
    }
  }

  async function releaseAudioPlayer() {
    if (!audioSound) return;
    await audioSound.unloadAsync().catch(() => {});
    setAudioSound(null);
    setAudioPlaying(false);
    setAudioPositionMillis(0);
    setAudioDurationMillis(0);
  }

  async function openDocument(doc: MedicalDocument) {
    if (!doc.file_path) {
      showAlert('Sin archivo original', 'Este adjunto no tiene archivo original disponible.');
      return;
    }

    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewUrl(null);
    await releaseAudioPlayer();

    const { data, error } = await supabase.storage
      .from('medical-documents')
      .createSignedUrl(doc.file_path, 3600);

    if (error || !data?.signedUrl) {
      setPreviewLoading(false);
      setPreviewDoc(null);
      showAlert('Error', error?.message ?? 'No se pudo abrir el adjunto original.');
      return;
    }

    setPreviewUrl(data.signedUrl);

    if (isAudioDocument(doc)) {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
      const { sound } = await Audio.Sound.createAsync(
        { uri: data.signedUrl },
        { shouldPlay: false },
        (status) => {
          if (!status.isLoaded) return;
          setAudioPlaying(status.isPlaying);
          setAudioPositionMillis(status.positionMillis ?? 0);
          setAudioDurationMillis(status.durationMillis ?? 0);
        }
      );
      setAudioSound(sound);
    }

    setPreviewLoading(false);
  }

  async function closePreview() {
    await releaseAudioPlayer();
    setPreviewDoc(null);
    setPreviewUrl(null);
    setPreviewLoading(false);
  }

  async function toggleAudioPlayback() {
    if (!audioSound) return;
    const status = await audioSound.getStatusAsync();
    if (!status.isLoaded) return;
    if (status.isPlaying) {
      await audioSound.pauseAsync();
      return;
    }
    await audioSound.playAsync();
  }

  async function removeFilesFromStorage(filePaths: string[]) {
    if (filePaths.length === 0) return null;

    const uniquePaths = [...new Set(filePaths.filter(Boolean))];
    if (uniquePaths.length === 0) return null;

    const { error } = await supabase.storage
      .from('medical-documents')
      .remove(uniquePaths);

    if (error) {
      console.warn('storage remove error:', error);
      return 'No se pudo limpiar uno o más archivos originales en Storage.';
    }

    return null;
  }

  function confirmDeleteDocument(doc: MedicalDocument) {
    if (Platform.OS === 'web') {
      showConfirm({
        title: 'Eliminar adjunto',
        message: 'Se eliminará el archivo original y todos los datos derivados de este adjunto.',
        confirmLabel: 'Eliminar todo',
        onConfirm: () => { void deleteDocument(doc, 'cascade'); },
      });
      return;
    }

    Alert.alert(
      'Eliminar adjunto',
      'Puedes quitar solo el archivo original o borrar también los medicamentos, exámenes y recordatorios creados desde este adjunto.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Solo adjunto',
          style: 'default',
          onPress: () => { void deleteDocument(doc, 'detach'); },
        },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: () => { void deleteDocument(doc, 'cascade'); },
        },
      ]
    );
  }

  async function deleteDocument(doc: MedicalDocument, mode: 'detach' | 'cascade') {
    setDeletingDocId(doc.id);
    try {
      const filePathsToDelete = new Set<string>();
      let detachedPrescriptionCount = 0;
      let detachedTestCount = 0;
      let deletedPrescriptionCount = 0;
      let deletedTestCount = 0;
      let deletedScheduleCount = 0;
      let deletedReminderCount = 0;

      if (doc.file_path) {
        filePathsToDelete.add(doc.file_path);
      }

      const { data, error } = mode === 'cascade'
        ? await supabase.rpc('delete_medical_document_with_dependencies', {
          p_document_id: doc.id,
        })
        : await supabase.rpc('delete_medical_document_attachment', {
          p_document_id: doc.id,
        });

      if (error && !isMissingRpc(error)) {
        showAlert('No se pudo eliminar', error.message);
        return;
      }

      if (mode === 'detach' && error && isMissingRpc(error)) {
        const [
          { data: linkedPrescriptions, error: rxError },
          { data: linkedTestsBySource, error: testsSourceError },
          { data: linkedTestsByResult, error: testsResultError },
        ] = await Promise.all([
          supabase
            .from('prescriptions')
            .select('id')
            .eq('medical_document_id', doc.id)
            .limit(200),
          supabase
            .from('medical_tests')
            .select('id')
            .eq('medical_document_id', doc.id)
            .limit(200),
          supabase
            .from('medical_tests')
            .select('id')
            .eq('result_document_id', doc.id)
            .limit(200),
        ]);

        if (rxError || testsSourceError || testsResultError) {
          throw rxError ?? testsSourceError ?? testsResultError;
        }

        detachedPrescriptionCount = linkedPrescriptions?.length ?? 0;
        detachedTestCount = new Set([
          ...(linkedTestsBySource ?? []).map((item) => item.id),
          ...(linkedTestsByResult ?? []).map((item) => item.id),
        ]).size;

        const [{ error: unlinkRxError }, { error: unlinkTestsSourceError }, { error: unlinkTestsResultError }] = await Promise.all([
          supabase
            .from('prescriptions')
            .update({ medical_document_id: null })
            .eq('medical_document_id', doc.id),
          supabase
            .from('medical_tests')
            .update({ medical_document_id: null })
            .eq('medical_document_id', doc.id),
          supabase
            .from('medical_tests')
            .update({ result_document_id: null })
            .eq('result_document_id', doc.id),
        ]);

        if (unlinkRxError || unlinkTestsSourceError || unlinkTestsResultError) {
          throw unlinkRxError ?? unlinkTestsSourceError ?? unlinkTestsResultError;
        }

        const { error: deleteError } = await supabase
          .from('medical_documents')
          .delete()
          .eq('id', doc.id);

        if (deleteError) {
          showAlert('No se pudo eliminar', deleteError.message);
          return;
        }
      } else if (mode === 'detach') {
        const result = (data ?? {}) as DeleteAttachmentResult;
        if (result.file_path) {
          filePathsToDelete.add(result.file_path);
        }
        detachedPrescriptionCount = result.detached_prescriptions ?? 0;
        detachedTestCount = result.detached_tests ?? 0;
      } else {
        if (error && isMissingRpc(error)) {
          showAlert('Falta actualizar la base de datos', 'Aplica la migración nueva para habilitar el borrado completo de adjuntos.');
          return;
        }

        const result = (data ?? {}) as CascadeDeleteResult;
        for (const path of result.file_paths ?? []) {
          if (path) filePathsToDelete.add(path);
        }
        deletedPrescriptionCount = result.deleted_prescriptions ?? 0;
        deletedTestCount = result.deleted_tests ?? 0;
        deletedScheduleCount = result.deleted_schedules ?? 0;
        deletedReminderCount = result.deleted_reminders ?? 0;
      }

      const storageWarning = await removeFilesFromStorage([...filePathsToDelete]) ?? '';

      if (previewDoc?.id === doc.id) {
        await closePreview();
      }

      setDocs((current) => current.filter((item) => item.id !== doc.id));

      const successNotes: string[] = [];
      if (mode === 'detach' && (detachedPrescriptionCount > 0 || detachedTestCount > 0)) {
        const preservedParts: string[] = [];
        if (detachedPrescriptionCount > 0) {
          preservedParts.push(
            `${detachedPrescriptionCount} ${detachedPrescriptionCount === 1 ? 'medicamento quedó registrado' : 'medicamentos quedaron registrados'}`
          );
        }
        if (detachedTestCount > 0) {
          preservedParts.push(
            `${detachedTestCount} ${detachedTestCount === 1 ? 'examen quedó registrado' : 'exámenes quedaron registrados'}`
          );
        }
        successNotes.push(`Se conservó la información clínica: ${preservedParts.join(' y ')}.`);
      }
      if (mode === 'cascade') {
        const deletedParts: string[] = [];
        if (deletedPrescriptionCount > 0) {
          deletedParts.push(`${deletedPrescriptionCount} medicamento${deletedPrescriptionCount === 1 ? '' : 's'}`);
        }
        if (deletedScheduleCount > 0) {
          deletedParts.push(`${deletedScheduleCount} dosis programada${deletedScheduleCount === 1 ? '' : 's'}`);
        }
        if (deletedTestCount > 0) {
          deletedParts.push(`${deletedTestCount} examen${deletedTestCount === 1 ? '' : 'es'}`);
        }
        if (deletedReminderCount > 0) {
          deletedParts.push(`${deletedReminderCount} recordatorio${deletedReminderCount === 1 ? '' : 's'}`);
        }
        if (deletedParts.length > 0) {
          successNotes.push(`Se eliminaron también los datos derivados: ${deletedParts.join(', ')}.`);
        }
      }
      if (storageWarning) {
        successNotes.push(storageWarning);
      }
      showAlert('Adjunto eliminado', successNotes.join(' ') || 'El adjunto se eliminó correctamente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
      showAlert('No se pudo eliminar', message);
    } finally {
      setDeletingDocId(null);
    }
  }

  function confirmDeleteVisit() {
    if (!visit) return;

    if (Platform.OS === 'web') {
      showConfirm({
        title: 'Eliminar visita',
        message: 'Se eliminará la visita junto con sus adjuntos y datos derivados.',
        confirmLabel: 'Eliminar todo',
        onConfirm: () => { void deleteVisitCascade(); },
      });
      return;
    }

    Alert.alert(
      'Eliminar visita',
      'Puedes ocultar la visita del historial o eliminar por completo la visita, sus adjuntos, medicamentos, exámenes y recordatorios asociados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Solo ocultar',
          style: 'default',
          onPress: () => { void softDeleteVisit(); },
        },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: () => { void deleteVisitCascade(); },
        },
      ]
    );
  }

  async function softDeleteVisit() {
    if (!visit) return;
    setDeletingVisit(true);
    try {
      const { error } = await supabase.rpc('soft_delete_medical_visit', {
        p_visit_id: visit.id,
      });

      if (error && !isMissingRpc(error)) {
        showAlert('No se pudo eliminar', error.message);
        return;
      }

      if (error && isMissingRpc(error)) {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) {
          throw authError;
        }

        const { error: fallbackError } = await supabase
          .from('medical_visits')
          .update({
            status: 'cancelled',
            deleted_at: new Date().toISOString(),
            deleted_by: authData.user?.id ?? null,
          })
          .eq('id', visit.id);

        if (fallbackError) {
          showAlert('No se pudo eliminar', fallbackError.message);
          return;
        }
      }

      await closePreview();
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
      showAlert('No se pudo eliminar', message);
    } finally {
      setDeletingVisit(false);
    }
  }

  async function deleteVisitCascade() {
    if (!visit) return;

    setDeletingVisit(true);
    try {
      const { data, error } = await supabase.rpc('delete_medical_visit_cascade', {
        p_visit_id: visit.id,
      });

      if (error) {
        if (isMissingRpc(error)) {
          showAlert('Falta actualizar la base de datos', 'Aplica la migración nueva para habilitar el borrado completo de visitas.');
          return;
        }

        showAlert('No se pudo eliminar', error.message);
        return;
      }

      const result = (data ?? {}) as CascadeDeleteResult;
      const storageWarning = await removeFilesFromStorage(result.file_paths ?? []) ?? '';

      await closePreview();

      const deletedParts: string[] = [];
      if ((result.deleted_documents ?? 0) > 0) {
        deletedParts.push(`${result.deleted_documents} adjunto${result.deleted_documents === 1 ? '' : 's'}`);
      }
      if ((result.deleted_prescriptions ?? 0) > 0) {
        deletedParts.push(`${result.deleted_prescriptions} medicamento${result.deleted_prescriptions === 1 ? '' : 's'}`);
      }
      if ((result.deleted_schedules ?? 0) > 0) {
        deletedParts.push(`${result.deleted_schedules} dosis programada${result.deleted_schedules === 1 ? '' : 's'}`);
      }
      if ((result.deleted_tests ?? 0) > 0) {
        deletedParts.push(`${result.deleted_tests} examen${result.deleted_tests === 1 ? '' : 'es'}`);
      }
      if ((result.deleted_reminders ?? 0) > 0) {
        deletedParts.push(`${result.deleted_reminders} recordatorio${result.deleted_reminders === 1 ? '' : 's'}`);
      }

      if (deletedParts.length > 0 || storageWarning) {
        const summaryMessage = [
          deletedParts.length > 0 ? `También se eliminaron: ${deletedParts.join(', ')}.` : '',
          storageWarning,
        ].filter(Boolean).join(' ');

        if (Platform.OS === 'web') {
          showAlert('Visita eliminada', summaryMessage);
          router.back();
          return;
        }

        Alert.alert('Visita eliminada', summaryMessage, [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
      showAlert('No se pudo eliminar', message);
    } finally {
      setDeletingVisit(false);
    }
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
  const visitStatusMeta = getVisitStatusMeta(visit.status);
  const isScheduledVisit = visit.status === 'scheduled';
  const isCancelledVisit = visit.status === 'cancelled';
  const visitHeaderContext = [visitMemberName, visit.doctor_name].filter(Boolean).join(' · ') || 'Sin familiar asignado';
  const canEditVisitDate = visit.status === 'scheduled';
  const canEditDiagnosis = visit.status !== 'scheduled';
  const canEditVisit = true;
  const editVisitLabel = isScheduledVisit ? 'Editar cita' : 'Editar visita';
  const doctorVoiceVisitItems = getVisitReviewItems(doctorVoiceStructured as Record<string, unknown> | null);
  const doctorVoiceVitalItems = getVitalsReviewItems(doctorVoiceStructured as Record<string, unknown> | null);
  const doctorVoiceMedications = normalizeVoiceMedications(doctorVoiceStructured?.medications);
  const doctorVoiceTests = normalizeVoiceTests(doctorVoiceStructured?.tests);
  const doctorVoiceTherapies = normalizeVoiceTherapies(doctorVoiceStructured?.therapies);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isScheduledVisit ? 'Detalle de cita' : 'Detalle de visita'}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {visitHeaderContext}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.deleteVisitBtn}
            onPress={confirmDeleteVisit}
            disabled={deletingVisit}
            activeOpacity={0.8}
          >
            {deletingVisit
              ? <ActivityIndicator color={Colors.alert} size="small" />
              : <Ionicons name="trash-outline" size={18} color={Colors.alert} />
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleAttach}
            activeOpacity={0.8}
          >
            <Ionicons name="camera-outline" size={18} color={Colors.white} />
            <Text style={styles.attachBtnText}>Adjuntar</Text>
          </TouchableOpacity>
        </View>
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

          <View style={styles.visitStatusRow}>
            <View style={[styles.visitStatusBadge, { backgroundColor: visitStatusMeta.backgroundColor }]}>
              <Ionicons name={visitStatusMeta.icon} size={14} color={visitStatusMeta.color} />
              <Text style={[styles.visitStatusText, { color: visitStatusMeta.color }]}>
                {visitStatusMeta.label}
              </Text>
            </View>
            {canEditVisit && (
              <TouchableOpacity
                style={styles.editVisitBtn}
                onPress={openEditVisitModal}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={canEditVisitDate ? 'calendar-outline' : 'create-outline'}
                  size={14}
                  color={Colors.primary}
                />
                <Text style={styles.editVisitBtnText}>{editVisitLabel}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          {/* Campos informativos */}
          {visitMemberName && (
            <InfoRow icon="people-outline" label="Familiar" value={visitMemberName} />
          )}
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
            <InfoRow icon="help-circle-outline" label="Motivo de consulta" value={visit.reason_for_visit} />
          )}
          {visit.diagnosis && (
            <InfoRow icon="document-text-outline" label="Diagnóstico" value={visit.diagnosis} multiline />
          )}
          {visit.notes && (
            <InfoRow icon="chatbox-ellipses-outline" label="Síntomas / notas" value={visit.notes} multiline />
          )}
        </View>

        {isScheduledVisit && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gestion de la cita</Text>
            <View style={styles.scheduledActions}>
              <TouchableOpacity
                style={[styles.statusActionBtn, styles.completeActionBtn]}
                onPress={confirmCompleteVisit}
                disabled={updatingStatus !== null}
                activeOpacity={0.8}
              >
                {updatingStatus === 'completed' ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color={Colors.white} />
                    <Text style={styles.statusActionText}>Marcar como realizada</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.statusActionBtn, styles.cancelActionBtn]}
                onPress={confirmCancelVisit}
                disabled={updatingStatus !== null}
                activeOpacity={0.8}
              >
                {updatingStatus === 'cancelled' ? (
                  <ActivityIndicator color={Colors.alert} size="small" />
                ) : (
                  <>
                    <Ionicons name="close-circle-outline" size={18} color={Colors.alert} />
                    <Text style={styles.cancelActionText}>Cancelar cita</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isCancelledVisit && (
          <View style={styles.section}>
            <View style={styles.cancelledInfoBox}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.alert} />
              <Text style={styles.cancelledInfoText}>
                Esta cita quedo cancelada y ya no generara recordatorios pendientes.
              </Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Consulta por voz</Text>
            {processingDoctorVoice ? <ActivityIndicator color={Colors.primary} size="small" /> : null}
          </View>
          <View style={styles.voiceCaptureCard}>
            <Text style={styles.voiceCaptureText}>
              Activa el micrófono mientras hablas con el médico para capturar la consulta, convertirla en texto y extraer medicamentos, exámenes y recomendaciones.
            </Text>
            <View style={styles.voiceCaptureActions}>
              <VoiceRecordButton
                size={60}
                onCapture={(payload) => { void handleDoctorVoiceCapture(payload); }}
                disabled={processingDoctorVoice || savingDoctorVoice}
              />
              <View style={styles.voiceCaptureCopy}>
                <Text style={styles.voiceCaptureTitle}>Nueva nota del médico</Text>
                <Text style={styles.voiceCaptureHint}>
                  Al terminar, podrás revisar la transcripción antes de guardarla en esta visita.
                </Text>
              </View>
            </View>
          </View>
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

        {(prescriptions.length > 0 || tests.length > 0) && (
          <View style={styles.section}>
            {prescriptions.length > 0 && (
              <View style={styles.relatedSectionCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Medicamentos de esta visita ({prescriptions.length})</Text>
                  <TouchableOpacity onPress={openMemberMedicationTimeline} activeOpacity={0.8}>
                    <Text style={styles.sectionLink}>Dosis hoy</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.relatedList}>
                  {prescriptions.map((prescription) => {
                    const statusMeta = getPrescriptionStatusMeta(prescription.status);
                    const isActivePrescription = prescription.status === 'active';

                    return (
                      <View key={prescription.id} style={styles.relatedItemCard}>
                        <View style={styles.relatedItemTopRow}>
                          <View style={styles.relatedItemCopy}>
                            <Text style={styles.relatedItemTitle}>{prescription.medication_name}</Text>
                            <Text style={styles.relatedItemMeta}>
                              {formatPrescriptionSummary(prescription)}
                            </Text>
                            {prescription.instructions ? (
                              <Text style={styles.relatedItemSubtle}>{prescription.instructions}</Text>
                            ) : null}
                          </View>

                          <View style={[styles.inlineStatusBadge, { backgroundColor: statusMeta.backgroundColor }]}>
                            <Text style={[styles.inlineStatusText, { color: statusMeta.color }]}>
                              {statusMeta.label}
                            </Text>
                          </View>
                        </View>

                        {isActivePrescription ? (
                          <TouchableOpacity
                            style={styles.inlineActionBtn}
                            onPress={() => confirmCompletePrescription(prescription)}
                            disabled={updatingPrescriptionId === prescription.id}
                            activeOpacity={0.8}
                          >
                            {updatingPrescriptionId === prescription.id ? (
                              <ActivityIndicator color={Colors.white} size="small" />
                            ) : (
                              <>
                                <Ionicons name="checkmark-circle-outline" size={16} color={Colors.white} />
                                <Text style={styles.inlineActionText}>Completar tratamiento</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {tests.length > 0 && (
              <View style={styles.relatedSectionCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Exámenes de esta visita ({tests.length})</Text>
                </View>

                <View style={styles.relatedList}>
                  {tests.map((test) => {
                    const statusMeta = getTestStatusMeta(test.status);
                    const isPendingTest = test.status === 'pending' || test.status === 'scheduled';

                    return (
                      <View key={test.id} style={styles.relatedItemCard}>
                        <View style={styles.relatedItemTopRow}>
                          <View style={styles.relatedItemCopy}>
                            <Text style={styles.relatedItemTitle}>{test.test_name}</Text>
                            <Text style={styles.relatedItemMeta}>{formatTestSummary(test)}</Text>
                            {test.notes ? (
                              <Text style={styles.relatedItemSubtle}>{test.notes}</Text>
                            ) : null}
                          </View>

                          <View style={[styles.inlineStatusBadge, { backgroundColor: statusMeta.backgroundColor }]}>
                            <Text style={[styles.inlineStatusText, { color: statusMeta.color }]}>
                              {statusMeta.label}
                            </Text>
                          </View>
                        </View>

                        {isPendingTest ? (
                          <TouchableOpacity
                            style={[styles.inlineActionBtn, styles.inlineActionBtnSecondary]}
                            onPress={() => confirmCompleteTest(test)}
                            disabled={updatingTestId === test.id}
                            activeOpacity={0.8}
                          >
                            {updatingTestId === test.id ? (
                              <ActivityIndicator color={Colors.primary} size="small" />
                            ) : (
                              <>
                                <Ionicons name="flask-outline" size={16} color={Colors.primary} />
                                <Text style={styles.inlineActionTextSecondary}>Marcar como realizado</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
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
                    <TouchableOpacity
                      style={styles.docMainPressable}
                      onPress={() => { void openDocument(doc); }}
                      disabled={!doc.file_path}
                      activeOpacity={doc.file_path ? 0.8 : 1}
                    >
                      <View style={[styles.docIconWrap, { backgroundColor: Colors.primary + '18' }]}>
                        <Ionicons name={getDocumentIcon(doc)} size={22} color={Colors.primary} />
                      </View>
                      <View style={styles.docInfo}>
                        <Text style={styles.docType}>
                          {getDocumentLabel(doc)}
                        </Text>
                        <Text style={styles.docDate}>
                          {formatCalendarDate(getDocumentReferenceDate(doc))}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: st.color + '22' }]}>
                        <Ionicons name={st.icon} size={12} color={st.color} />
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.docActionsRow}>
                      <TouchableOpacity
                        style={[styles.docActionBtn, !doc.file_path && styles.docActionBtnDisabled]}
                        onPress={() => { void openDocument(doc); }}
                        disabled={!doc.file_path}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={isAudioDocument(doc) ? 'play-circle-outline' : 'expand-outline'}
                          size={18}
                          color={!doc.file_path ? Colors.textMuted : Colors.primary}
                        />
                        <Text style={[styles.docActionText, !doc.file_path && styles.docActionTextDisabled]}>
                          Abrir
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.docActionBtn, styles.docDeleteActionBtn]}
                        onPress={() => confirmDeleteDocument(doc)}
                        disabled={deletingDocId === doc.id}
                        activeOpacity={0.8}
                      >
                        {deletingDocId === doc.id ? (
                          <ActivityIndicator color={Colors.alert} size="small" />
                        ) : (
                          <>
                            <Ionicons name="trash-outline" size={18} color={Colors.alert} />
                            <Text style={styles.docDeleteActionText}>Eliminar</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>

      <Modal
        visible={doctorVoiceModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeDoctorVoiceModal}
      >
        <KeyboardAvoidingView
          style={styles.editOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.editSheet}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>Nota del médico</Text>
                <Text style={styles.previewSubtitle}>
                  {visitMemberName ?? 'Visita médica'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.backBtn}
                onPress={closeDoctorVoiceModal}
                disabled={savingDoctorVoice || processingDoctorVoice}
              >
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.transcriptBox}>
                <View style={styles.transcriptHeader}>
                  <Ionicons name="mic" size={14} color={Colors.primary} />
                  <Text style={styles.transcriptLabel}>Transcripción</Text>
                </View>
                <Text style={styles.transcriptText}>{doctorVoiceTranscript}</Text>
              </View>

              {doctorVoiceVisitItems.length > 0 && (
                <View style={styles.extractedCard}>
                  <Text style={styles.extractedTitle}>Datos detectados de la visita</Text>
                  {doctorVoiceVisitItems.map((item) => (
                    <View key={item.label} style={styles.extractedRow}>
                      <Text style={styles.extractedLabel}>{item.label}</Text>
                      <Text style={styles.extractedValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              {doctorVoiceVitalItems.length > 0 && (
                <View style={styles.extractedCard}>
                  <Text style={styles.extractedTitle}>Signos vitales detectados</Text>
                  {doctorVoiceVitalItems.map((item) => (
                    <View key={item.label} style={styles.extractedRow}>
                      <Text style={styles.extractedLabel}>{item.label}</Text>
                      <Text style={styles.extractedValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
              )}

              {doctorVoiceMedications.length > 0 && (
                <View style={styles.extractedCard}>
                  <Text style={styles.extractedTitle}>Medicamentos ({doctorVoiceMedications.length})</Text>
                  {doctorVoiceMedications.map((item, index) => (
                    <View key={`${item.medication_name ?? 'med'}-${index}`} style={styles.medRow}>
                      <Ionicons name="medkit-outline" size={14} color={Colors.healthy} />
                      <Text style={styles.medRowText}>
                        {item.medication_name}
                        {item.dose_amount ? ` ${item.dose_amount}${item.dose_unit ?? ''}` : ''}
                        {item.frequency_text ? ` · ${item.frequency_text}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {doctorVoiceTests.length > 0 && (
                <View style={styles.extractedCard}>
                  <Text style={styles.extractedTitle}>Exámenes ({doctorVoiceTests.length})</Text>
                  {doctorVoiceTests.map((item, index) => (
                    <View key={`${item.test_name ?? 'test'}-${index}`} style={styles.medRow}>
                      <Ionicons name="flask-outline" size={14} color={Colors.info} />
                      <Text style={styles.medRowText}>
                        {item.test_name}
                        {item.category ? ` · ${item.category}` : ''}
                        {item.instructions ? ` · ${item.instructions}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {doctorVoiceTherapies.length > 0 && (
                <View style={styles.extractedCard}>
                  <Text style={styles.extractedTitle}>Terapias / recomendaciones ({doctorVoiceTherapies.length})</Text>
                  {doctorVoiceTherapies.map((item, index) => (
                    <View key={`${item.therapy_name ?? 'therapy'}-${index}`} style={styles.medRow}>
                      <Ionicons name="fitness-outline" size={14} color={Colors.warning} />
                      <Text style={styles.medRowText}>
                        {item.therapy_name}
                        {item.frequency_text ? ` · ${item.frequency_text}` : ''}
                        {item.duration_days ? ` · ${item.duration_days} día(s)` : ''}
                        {item.instructions ? ` · ${item.instructions}` : ''}
                      </Text>
                    </View>
                  ))}
                  <Text style={styles.editHelperText}>
                    Las terapias y recomendaciones se guardarán en observaciones porque aún no existe un módulo estructurado para ellas.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={closeDoctorVoiceModal}
                disabled={savingDoctorVoice}
                activeOpacity={0.8}
              >
                <Text style={styles.editCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveBtn, savingDoctorVoice && { opacity: 0.7 }]}
                onPress={() => { void saveDoctorVoiceCapture(); }}
                disabled={savingDoctorVoice}
                activeOpacity={0.8}
              >
                {savingDoctorVoice ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.editSaveBtnText}>Guardar nota</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeEditVisitModal}
      >
        <KeyboardAvoidingView
          style={styles.editOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.editSheet}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>
                  {isScheduledVisit ? 'Editar cita' : 'Editar visita'}
                </Text>
                <Text style={styles.previewSubtitle}>
                  {visitMemberName ?? 'Visita médica'}
                </Text>
              </View>
              <TouchableOpacity style={styles.backBtn} onPress={closeEditVisitModal} disabled={savingVisitEdit}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.editContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {canEditVisitDate && (
                <>
                  <Text style={styles.editHelperText}>
                    Cambia la fecha de la cita futura. El sistema actualizará sus recordatorios automáticamente.
                  </Text>
                  <DatePickerField
                    label="Nueva fecha de la cita"
                    value={editVisitDate}
                    onChange={setEditVisitDate}
                    withTime
                    minimumDate={new Date()}
                  />
                </>
              )}

              <View style={styles.editField}>
                <Text style={styles.editFieldLabel}>Motivo de consulta</Text>
                <TextInput
                  style={styles.editFieldInputCompact}
                  value={editReasonForVisit}
                  onChangeText={setEditReasonForVisit}
                  placeholder="Ej: tos persistente, control pediátrico"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.editField}>
                <Text style={styles.editFieldLabel}>Síntomas u observaciones</Text>
                <TextInput
                  style={styles.editFieldInput}
                  value={editSymptoms}
                  onChangeText={setEditSymptoms}
                  placeholder="Ej: fiebre, dolor de oído, congestión..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              {canEditDiagnosis && (
                <View style={styles.editField}>
                  <View style={styles.editFieldHeader}>
                    <Text style={styles.editFieldLabel}>Diagnóstico</Text>
                    <TouchableOpacity
                      style={[styles.inferDiagnosisBtn, inferringDiagnosis && { opacity: 0.7 }]}
                      onPress={() => { void inferDiagnosisWithAI(); }}
                      disabled={inferringDiagnosis || savingVisitEdit}
                      activeOpacity={0.8}
                    >
                      {inferringDiagnosis ? (
                        <ActivityIndicator color={Colors.primary} size="small" />
                      ) : (
                        <>
                          <Ionicons name="sparkles-outline" size={14} color={Colors.primary} />
                          <Text style={styles.inferDiagnosisBtnText}>Inferir con IA</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={styles.editFieldInput}
                    value={editDiagnosis}
                    onChangeText={setEditDiagnosis}
                    placeholder="Escribe el diagnóstico clínico"
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    textAlignVertical="top"
                  />
                  <Text style={styles.editHelperText}>
                    Este diagnóstico se mostrará en historial, búsquedas y detalle de la visita. La IA toma en cuenta motivo, síntomas, medicamentos y exámenes para inferir uno técnico con una explicación sencilla.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={closeEditVisitModal}
                disabled={savingVisitEdit}
                activeOpacity={0.8}
              >
                <Text style={styles.editCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editSaveBtn, savingVisitEdit && { opacity: 0.7 }]}
                onPress={() => { void saveVisitEdit(); }}
                disabled={savingVisitEdit}
                activeOpacity={0.8}
              >
                {savingVisitEdit ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.editSaveBtnText}>Guardar cambios</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!previewDoc}
        animationType="slide"
        transparent
        onRequestClose={() => { void closePreview(); }}
      >
        <View style={styles.previewOverlay}>
          <View style={styles.previewSheet}>
            <View style={styles.previewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle}>{previewDoc ? getDocumentLabel(previewDoc) : 'Adjunto'}</Text>
                <Text style={styles.previewSubtitle}>Archivo original</Text>
              </View>
              <TouchableOpacity style={styles.backBtn} onPress={() => { void closePreview(); }}>
                <Ionicons name="close" size={22} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {previewLoading ? (
              <View style={styles.previewBodyCenter}>
                <ActivityIndicator color={Colors.primary} size="large" />
              </View>
            ) : previewDoc && previewUrl && isImageDocument(previewDoc) ? (
              <View style={styles.previewBody}>
                <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
              </View>
            ) : previewDoc && previewUrl && isAudioDocument(previewDoc) ? (
              <View style={styles.previewBodyCenter}>
                <View style={styles.audioCard}>
                  <View style={styles.audioIconWrap}>
                    <Ionicons name="mic" size={28} color={Colors.primary} />
                  </View>
                  <Text style={styles.audioTitle}>Nota de voz original</Text>
                  <Text style={styles.audioMeta}>
                    {formatAudioTime(audioPositionMillis)} / {formatAudioTime(audioDurationMillis)}
                  </Text>
                  <TouchableOpacity style={styles.audioPlayBtn} onPress={() => { void toggleAudioPlayback(); }}>
                    <Ionicons name={audioPlaying ? 'pause' : 'play'} size={24} color={Colors.white} />
                    <Text style={styles.audioPlayText}>{audioPlaying ? 'Pausar' : 'Reproducir'}</Text>
                  </TouchableOpacity>
                  {!!previewDoc.extracted_text && (
                    <View style={styles.audioTranscriptBox}>
                      <Text style={styles.audioTranscriptLabel}>Transcripción</Text>
                      <Text style={styles.audioTranscriptText}>{previewDoc.extracted_text}</Text>
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.previewBodyCenter}>
                <Text style={styles.emptyText}>No se pudo previsualizar este adjunto.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasVitals(v: MedicalVisit) {
  return v.weight_kg != null || v.height_cm != null || v.temperature_c != null ||
    v.blood_pressure != null || v.heart_rate != null;
}

function getVisitStatusMeta(status: VisitStatus) {
  switch (status) {
    case 'scheduled':
      return {
        label: 'Cita programada',
        color: Colors.info,
        backgroundColor: Colors.infoBg,
        icon: 'time-outline' as const,
      };
    case 'cancelled':
      return {
        label: 'Cancelada',
        color: Colors.alert,
        backgroundColor: Colors.alertBg,
        icon: 'close-circle-outline' as const,
      };
    case 'completed':
      return {
        label: 'Completada',
        color: Colors.healthy,
        backgroundColor: Colors.healthyBg,
        icon: 'checkmark-circle-outline' as const,
      };
    default:
      return {
        label: 'Borrador',
        color: Colors.warning,
        backgroundColor: Colors.warningBg,
        icon: 'document-text-outline' as const,
      };
  }
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

function getPrescriptionStatusMeta(status: Prescription['status']) {
  switch (status) {
    case 'active':
      return {
        label: 'Activo',
        color: Colors.healthy,
        backgroundColor: Colors.healthyBg,
      };
    case 'paused':
      return {
        label: 'Pausado',
        color: Colors.warning,
        backgroundColor: Colors.warningBg,
      };
    case 'cancelled':
      return {
        label: 'Cancelado',
        color: Colors.alert,
        backgroundColor: Colors.alertBg,
      };
    default:
      return {
        label: 'Completado',
        color: Colors.textSecondary,
        backgroundColor: Colors.surfaceHigh,
      };
  }
}

function getTestStatusMeta(status: MedicalTest['status']) {
  switch (status) {
    case 'pending':
      return {
        label: 'Pendiente',
        color: Colors.warning,
        backgroundColor: Colors.warningBg,
      };
    case 'scheduled':
      return {
        label: 'Programado',
        color: Colors.info,
        backgroundColor: Colors.infoBg,
      };
    case 'result_uploaded':
      return {
        label: 'Resultado',
        color: Colors.primary,
        backgroundColor: Colors.infoBg,
      };
    case 'cancelled':
      return {
        label: 'Cancelado',
        color: Colors.alert,
        backgroundColor: Colors.alertBg,
      };
    default:
      return {
        label: 'Completado',
        color: Colors.healthy,
        backgroundColor: Colors.healthyBg,
      };
  }
}

function formatPrescriptionSummary(prescription: Prescription) {
  const parts = [
    prescription.dose_amount != null
      ? `${prescription.dose_amount} ${prescription.dose_unit ?? ''}`.trim()
      : null,
    prescription.frequency_text,
    prescription.route,
  ].filter(Boolean);

  return parts.join(' · ') || 'Sin detalle de dosis';
}

function formatTestSummary(test: MedicalTest) {
  const when = test.due_at ?? test.scheduled_at ?? test.ordered_at ?? test.completed_at;
  const whenLabel = when
    ? formatCalendarDate(when)
    : null;

  const parts = [
    test.category,
    whenLabel,
  ].filter(Boolean);

  return parts.join(' · ') || 'Sin fecha clínica registrada';
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  deleteVisitBtn: {
    width: 38, height: 38, backgroundColor: Colors.alertBg,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.alert + '33',
  },
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
  visitStatusRow: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  visitStatusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  visitStatusText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  editVisitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  editVisitBtnText: {
    color: Colors.primary,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  divider:  { height: 1, backgroundColor: Colors.border, marginVertical: 4 },
  infoRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  infoIcon: { marginTop: 3 },
  infoLabel:{ color: Colors.textMuted,    fontSize: Typography.xs, fontWeight: Typography.medium },
  infoValue:{ color: Colors.textPrimary,  fontSize: Typography.sm, marginTop: 1, lineHeight: 18 },

  // Vitals
  section:       { gap: Spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:  { color: Colors.textPrimary, fontSize: Typography.md, fontWeight: Typography.bold },
  voiceCaptureCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  voiceCaptureText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  voiceCaptureActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  voiceCaptureCopy: {
    flex: 1,
    gap: 4,
  },
  voiceCaptureTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  voiceCaptureHint: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    lineHeight: 18,
  },
  transcriptBox: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  transcriptLabel: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  transcriptText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  extractedCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  extractedTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  extractedRow: {
    gap: 2,
  },
  extractedLabel: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  extractedValue: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 18,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  medRowText: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 18,
  },
  addDocBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addDocText:    { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  sectionLink:   { color: Colors.primaryLight, fontSize: Typography.sm, fontWeight: Typography.semibold },

  vitalsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
  },
  relatedSectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  relatedList: {
    gap: Spacing.sm,
  },
  relatedItemCard: {
    backgroundColor: Colors.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  relatedItemTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  relatedItemCopy: {
    flex: 1,
    gap: 4,
  },
  relatedItemTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  relatedItemMeta: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
  },
  relatedItemSubtle: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    lineHeight: 18,
  },
  inlineStatusBadge: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  inlineStatusText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  inlineActionBtn: {
    minHeight: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.healthy,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  inlineActionBtnSecondary: {
    backgroundColor: Colors.infoBg,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
  },
  inlineActionText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  inlineActionTextSecondary: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: '85%',
    paddingBottom: Spacing.lg,
  },
  editContent: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.base,
    gap: Spacing.base,
  },
  editField: {
    gap: Spacing.sm,
  },
  editFieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  editFieldLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  inferDiagnosisBtn: {
    minHeight: 34,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  inferDiagnosisBtnText: {
    color: Colors.primary,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  editFieldInput: {
    minHeight: 120,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  editFieldInputCompact: {
    minHeight: 68,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  editHelperText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    lineHeight: 18,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
  },
  editCancelBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  editSaveBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveBtnText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  scheduledActions: { gap: Spacing.sm },
  statusActionBtn: {
    minHeight: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  completeActionBtn: {
    backgroundColor: Colors.healthy,
  },
  cancelActionBtn: {
    backgroundColor: Colors.alertBg,
    borderWidth: 1,
    borderColor: Colors.alert + '33',
  },
  statusActionText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  cancelActionText: {
    color: Colors.alert,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  cancelledInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.alertBg,
    padding: Spacing.md,
  },
  cancelledInfoText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
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
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  docMainPressable: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  docIconWrap: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  docInfo:     { flex: 1, gap: 2 },
  docType:     { color: Colors.textPrimary,   fontSize: Typography.sm, fontWeight: Typography.medium },
  docDate:     { color: Colors.textSecondary, fontSize: Typography.xs },
  docActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  docActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  docActionBtnDisabled: {
    opacity: 0.55,
  },
  docActionText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  docActionTextDisabled: {
    color: Colors.textMuted,
  },
  docDeleteActionBtn: {
    backgroundColor: Colors.alertBg,
    borderColor: Colors.alert + '22',
  },
  docDeleteActionText: {
    color: Colors.alert,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  statusText:  { fontSize: Typography.xs, fontWeight: Typography.medium },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:   { color: Colors.textMuted, fontSize: Typography.base },

  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 15, 32, 0.78)',
    justifyContent: 'flex-end',
  },
  previewSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    minHeight: '72%',
    maxHeight: '92%',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.xl,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.base,
  },
  previewTitle: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  previewSubtitle: { color: Colors.textSecondary, fontSize: Typography.sm, marginTop: 2 },
  previewBody: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  previewBodyCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    minHeight: 420,
    backgroundColor: Colors.surface,
  },
  audioCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  audioIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '1F',
  },
  audioTitle: { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.semibold },
  audioMeta: { color: Colors.textSecondary, fontSize: Typography.sm },
  audioPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    height: 48,
  },
  audioPlayText: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },
  audioTranscriptBox: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  audioTranscriptLabel: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    textTransform: 'uppercase',
  },
  audioTranscriptText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
});
