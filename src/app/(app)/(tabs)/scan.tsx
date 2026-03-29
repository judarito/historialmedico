import { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../services/supabase';
import { useFamilyStore } from '../../../store/familyStore';
import { useAuthStore } from '../../../store/authStore';
import { Colors, Typography, Spacing, Radius } from '../../../theme';
import { DatePickerField } from '../../../components/ui/DatePickerField';
import type { Database } from '../../../types/database.types';

type FamilyMember = Database['public']['Tables']['family_members']['Row'];
type MedicalVisit = Database['public']['Tables']['medical_visits']['Row'];
type Step = 'member' | 'visit' | 'photo';

function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ScanTab() {
  const { memberId: preselectedMemberId, visitId: preselectedVisitId } = useLocalSearchParams<{
    memberId?: string;
    visitId?:  string;
  }>();
  const { members, fetchMembers, tenant, family } = useFamilyStore();
  const { user } = useAuthStore();

  const [step,           setStep]           = useState<Step>('member');
  const [selectedMember, setSelectedMember] = useState<FamilyMember | null>(null);
  const [selectedVisit,  setSelectedVisit]  = useState<MedicalVisit | null>(null);
  const [visits,         setVisits]         = useState<MedicalVisit[]>([]);
  const [loadingVisits,  setLoadingVisits]  = useState(false);

  // Nueva visita inline
  const [showNewVisit,    setShowNewVisit]    = useState(false);
  const [newVisitDate,    setNewVisitDate]    = useState(todayISO());
  const [newVisitDoctor,  setNewVisitDoctor]  = useState('');
  const [savingVisit,     setSavingVisit]     = useState(false);

  // Foto
  const [image,     setImage]     = useState<{ uri: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchMembers().then(async () => {
      const ms = useFamilyStore.getState().members;

      // Caso: viene desde detalle de visita (memberId + visitId) → saltar a foto
      if (preselectedMemberId && preselectedVisitId) {
        const foundMember = ms.find(m => m.id === preselectedMemberId);
        if (foundMember) {
          setSelectedMember(foundMember);
          const { data } = await supabase
            .from('medical_visits')
            .select('*')
            .eq('id', preselectedVisitId)
            .single();
          if (data) { setSelectedVisit(data as MedicalVisit); setStep('photo'); return; }
        }
      }

      // Caso: viene desde detalle de miembro (solo memberId) → saltar a visita
      if (preselectedMemberId) {
        const found = ms.find(m => m.id === preselectedMemberId);
        if (found) { setSelectedMember(found); goToVisitStep(found.id); return; }
      }

      // Caso normal: solo un miembro
      if (ms.length === 1) setSelectedMember(ms[0]);
    });
  }, []);

  async function goToVisitStep(memberId?: string) {
    const id = memberId ?? selectedMember?.id;
    if (!id) return;
    setLoadingVisits(true);
    setStep('visit');
    const { data } = await supabase
      .from('medical_visits')
      .select('id, visit_date, doctor_name, specialty, institution_name')
      .eq('family_member_id', id)
      .order('visit_date', { ascending: false })
      .limit(10);
    setVisits((data as MedicalVisit[]) ?? []);
    setLoadingVisits(false);
  }

  async function createVisit() {
    if (!tenant || !family || !user || !selectedMember) return;
    setSavingVisit(true);
    const { data, error } = await supabase
      .from('medical_visits')
      .insert({
        tenant_id:        tenant.id,
        family_id:        family.id,
        family_member_id: selectedMember.id,
        visit_date:       new Date(newVisitDate).toISOString(),
        doctor_name:      newVisitDoctor.trim() || null,
        status:           'completed',
        created_by:       user.id,
      })
      .select()
      .single();
    setSavingVisit(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setSelectedVisit(data as MedicalVisit);
    setShowNewVisit(false);
    setStep('photo');
  }

  async function pickImage(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso requerido', fromCamera ? 'Necesitamos acceso a la cámara.' : 'Necesitamos acceso a la galería.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]) {
      setImage({ uri: result.assets[0].uri });
    }
  }

  async function handleUpload() {
    if (!selectedMember || !selectedVisit || !image || !tenant || !family || !user) return;
    setUploading(true);
    try {
      const filePath = `${tenant.id}/${family.id}/${selectedMember.id}/${Date.now()}.jpg`;
      const response = await fetch(image.uri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: storageErr } = await supabase.storage
        .from('medical-documents')
        .upload(filePath, new Uint8Array(arrayBuffer), { contentType: 'image/jpeg', upsert: false });
      if (storageErr) throw new Error(storageErr.message);

      const { data: doc, error: docErr } = await supabase
        .from('medical_documents')
        .insert({
          tenant_id:         tenant.id,
          family_id:         family.id,
          family_member_id:  selectedMember.id,
          medical_visit_id:  selectedVisit.id,
          document_type:     'formula',
          file_path:         filePath,
          processing_status: 'pending',
          verified_by_user:  false,
          created_by:        user.id,
        })
        .select()
        .single();
      if (docErr) throw new Error(docErr.message);

      const { error: fnErr } = await supabase.functions.invoke('process-prescription', {
        body: { document_id: doc.id },
      });
      if (fnErr) console.warn('Edge function error:', fnErr.message);

      setUploading(false);
      setImage(null);
      router.push({
        pathname: '/(app)/confirm-scan',
        params: {
          documentId:  doc.id,
          memberName:  selectedMember.first_name,
          visitId:     selectedVisit.id,
          visitDate:   selectedVisit.visit_date,
          doctorName:  selectedVisit.doctor_name ?? '',
        },
      });
    } catch (err: any) {
      setUploading(false);
      Alert.alert('Error al subir', err.message ?? 'Intenta de nuevo');
    }
  }

  function reset() {
    setStep('member');
    setSelectedMember(null);
    setSelectedVisit(null);
    setVisits([]);
    setImage(null);
    setShowNewVisit(false);
    setNewVisitDoctor('');
    setNewVisitDate(todayISO());
  }

  // ── Step: member ────────────────────────────────────────────────────────────
  if (step === 'member') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Adjuntar documento</Text>
          <Text style={styles.subtitle}>
            Toma foto de una fórmula, resultado o cualquier documento médico.
          </Text>

          <Text style={styles.sectionLabel}>¿Para quién es?</Text>
          {members.map(m => (
            <TouchableOpacity
              key={m.id}
              style={[styles.memberCard, selectedMember?.id === m.id && styles.memberCardActive]}
              onPress={() => setSelectedMember(m)}
            >
              <View style={styles.memberCardLeft}>
                <View style={[styles.memberAvatar, selectedMember?.id === m.id && styles.memberAvatarActive]}>
                  <Text style={[styles.memberInitial, selectedMember?.id === m.id && styles.memberInitialActive]}>
                    {m.first_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.memberCardName}>{m.first_name} {m.last_name ?? ''}</Text>
              </View>
              {selectedMember?.id === m.id && (
                <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.primaryBtn, !selectedMember && { opacity: 0.45 }]}
            onPress={() => goToVisitStep()}
            disabled={!selectedMember}
          >
            <Text style={styles.primaryBtnText}>Continuar</Text>
            <Ionicons name="arrow-forward" size={20} color={Colors.white} />
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: visit ─────────────────────────────────────────────────────────────
  if (step === 'visit') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stepHeader}>
          <TouchableOpacity onPress={() => setStep('member')} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.stepHeaderTitle}>Vincular visita</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subtitle}>
            ¿A qué visita de{' '}
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>{selectedMember?.first_name}</Text>
            {' '}corresponde este documento?
          </Text>

          {/* Crear nueva visita */}
          <TouchableOpacity
            style={[styles.newVisitToggle, showNewVisit && styles.newVisitToggleActive]}
            onPress={() => setShowNewVisit(v => !v)}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={showNewVisit ? Colors.white : Colors.primary}
            />
            <Text style={[styles.newVisitToggleText, showNewVisit && { color: Colors.white }]}>
              Crear nueva visita
            </Text>
          </TouchableOpacity>

          {showNewVisit && (
            <View style={styles.newVisitForm}>
              <DatePickerField
                label="Fecha de la visita *"
                value={newVisitDate}
                onChange={setNewVisitDate}
                withTime
                maximumDate={new Date()}
              />
              <View style={{ gap: 6 }}>
                <Text style={styles.formLabel}>Médico (opcional)</Text>
                <TextInput
                  style={styles.formInput}
                  value={newVisitDoctor}
                  onChangeText={setNewVisitDoctor}
                  placeholder="Nombre del médico"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                />
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, savingVisit && { opacity: 0.6 }]}
                onPress={createVisit}
                disabled={savingVisit}
              >
                {savingVisit
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.primaryBtnText}>Crear y continuar</Text>
                }
              </TouchableOpacity>
            </View>
          )}

          {/* Visitas existentes */}
          {loadingVisits ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
          ) : visits.length > 0 ? (
            <View style={{ gap: Spacing.sm }}>
              <Text style={styles.sectionLabel}>O selecciona una visita existente</Text>
              {visits.map(v => (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.visitCard, selectedVisit?.id === v.id && styles.visitCardActive]}
                  onPress={() => setSelectedVisit(v)}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.visitDate}>{formatDate(v.visit_date)}</Text>
                    {v.doctor_name && <Text style={styles.visitDoctor}>{v.doctor_name}</Text>}
                    {v.specialty  && <Text style={styles.visitSpecialty}>{v.specialty}</Text>}
                  </View>
                  {selectedVisit?.id === v.id && (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : !showNewVisit ? (
            <View style={styles.emptyBox}>
              <Ionicons name="calendar-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                Sin visitas registradas. Crea una nueva arriba.
              </Text>
            </View>
          ) : null}

          {selectedVisit && !showNewVisit && (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('photo')}>
              <Text style={styles.primaryBtnText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={20} color={Colors.white} />
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step: photo ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.stepHeader}>
        <TouchableOpacity onPress={() => { setStep('visit'); setImage(null); }} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepHeaderTitle}>Tomar foto</Text>
          <Text style={styles.stepHeaderSub}>
            {selectedMember?.first_name} · {formatDate(selectedVisit?.visit_date)}
          </Text>
        </View>
        <TouchableOpacity onPress={reset} style={styles.backBtn}>
          <Ionicons name="close" size={22} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {image ? (
          <View style={styles.preview}>
            <Image source={{ uri: image.uri }} style={styles.previewImg} resizeMode="cover" />
            <TouchableOpacity style={styles.removeImg} onPress={() => setImage(null)}>
              <Ionicons name="close-circle" size={28} color={Colors.alert} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.pickerArea}>
            <Ionicons name="document-text-outline" size={56} color={Colors.textMuted} />
            <Text style={styles.pickerHint}>Sin imagen seleccionada</Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionCard} onPress={() => pickImage(true)}>
            <View style={[styles.actionIcon, { backgroundColor: Colors.primary + '22' }]}>
              <Ionicons name="camera" size={28} color={Colors.primary} />
            </View>
            <Text style={styles.actionText}>Cámara</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => pickImage(false)}>
            <View style={[styles.actionIcon, { backgroundColor: Colors.info + '22' }]}>
              <Ionicons name="images-outline" size={28} color={Colors.info} />
            </View>
            <Text style={styles.actionText}>Galería</Text>
          </TouchableOpacity>
        </View>

        {image && (
          <TouchableOpacity
            style={[styles.processBtn, uploading && { opacity: 0.6 }]}
            onPress={handleUpload}
            disabled={uploading}
            activeOpacity={0.8}
          >
            {uploading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator color={Colors.white} size="small" />
                <Text style={styles.processBtnText}>Procesando con IA...</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="sparkles" size={20} color={Colors.white} />
                <Text style={styles.processBtnText}>Analizar con IA</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.info} />
          <Text style={styles.infoText}>
            La IA extrae medicamentos, dosis y exámenes. Siempre podrás revisar y editar antes de guardar.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.lg },

  title:    { color: Colors.textPrimary,   fontSize: Typography.xl,  fontWeight: Typography.bold },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.sm,  lineHeight: 20 },

  sectionLabel: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.semibold },

  // Step header
  stepHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:        { width: 38, height: 38, backgroundColor: Colors.surface, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  stepHeaderTitle: { color: Colors.textPrimary, fontSize: Typography.md, fontWeight: Typography.bold },
  stepHeaderSub:   { color: Colors.textSecondary, fontSize: Typography.xs },

  // Member selection
  memberCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  memberCardActive:  { borderColor: Colors.primary, backgroundColor: Colors.primary + '0D' },
  memberCardLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  memberAvatar:      { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  memberAvatarActive:{ backgroundColor: Colors.primary + '33' },
  memberInitial:     { color: Colors.textSecondary, fontSize: Typography.md, fontWeight: Typography.bold },
  memberInitialActive: { color: Colors.primary },
  memberCardName:    { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.medium },

  // Visit step
  newVisitToggle: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.primary + '66',
    borderStyle: 'dashed', padding: Spacing.md,
  },
  newVisitToggleActive: { backgroundColor: Colors.primary, borderStyle: 'solid', borderColor: Colors.primary },
  newVisitToggleText:   { color: Colors.primary, fontSize: Typography.base, fontWeight: Typography.semibold },
  newVisitForm: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, gap: Spacing.md,
  },
  formLabel: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  formInput: {
    backgroundColor: Colors.background, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 48,
    color: Colors.textPrimary, fontSize: Typography.base,
  },
  visitCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  visitCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '0D' },
  visitDate:       { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.semibold },
  visitDoctor:     { color: Colors.textSecondary, fontSize: Typography.sm },
  visitSpecialty:  { color: Colors.textMuted,     fontSize: Typography.xs },
  emptyBox: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center' },

  // Photo step
  preview:    { position: 'relative', height: 220, borderRadius: Radius.xl, overflow: 'hidden' },
  previewImg: { width: '100%', height: '100%' },
  removeImg:  { position: 'absolute', top: 8, right: 8 },
  pickerArea: {
    height: 180, backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  pickerHint: { color: Colors.textMuted, fontSize: Typography.sm },
  actions:    { flexDirection: 'row', gap: Spacing.md },
  actionCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  actionIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: Colors.textPrimary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  processBtn: {
    height: 56, backgroundColor: Colors.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
  },
  processBtnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },

  // Shared
  primaryBtn: {
    height: 52, backgroundColor: Colors.primary, borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  primaryBtnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
  infoBox: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.infoBg,
    borderRadius: Radius.md, padding: Spacing.md, alignItems: 'flex-start',
  },
  infoText: { color: Colors.textSecondary, fontSize: Typography.xs, flex: 1, lineHeight: 18 },
});
