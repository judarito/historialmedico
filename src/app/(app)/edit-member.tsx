import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { DatePickerField } from '../../components/ui/DatePickerField';
import type { Database } from '../../types/database.types';

type FamilyMember = Database['public']['Tables']['family_members']['Row'];
type RelType = FamilyMember['relationship'];

const RELATIONSHIPS: { value: RelType; label: string }[] = [
  { value: 'self',        label: 'Yo mismo' },
  { value: 'spouse',      label: 'Cónyuge / Pareja' },
  { value: 'son',         label: 'Hijo' },
  { value: 'daughter',    label: 'Hija' },
  { value: 'father',      label: 'Padre' },
  { value: 'mother',      label: 'Madre' },
  { value: 'brother',     label: 'Hermano' },
  { value: 'sister',      label: 'Hermana' },
  { value: 'grandfather', label: 'Abuelo' },
  { value: 'grandmother', label: 'Abuela' },
  { value: 'guardian',    label: 'Tutor' },
  { value: 'other',       label: 'Otro' },
];

export default function EditMemberRoute() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { tenant, fetchMembers } = useFamilyStore();

  const [member,       setMember]       = useState<FamilyMember | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [showRelPicker, setShowRelPicker] = useState(false);

  // Form state
  const [firstName,    setFirstName]    = useState('');
  const [lastName,     setLastName]     = useState('');
  const [birthDate,    setBirthDate]    = useState('');
  const [relationship, setRelationship] = useState<RelType>('other');
  const [sex,          setSex]          = useState('');
  const [bloodType,    setBloodType]    = useState('');
  const [epsName,      setEpsName]      = useState('');
  const [allergies,    setAllergies]    = useState('');
  const [conditions,   setConditions]   = useState('');
  const [emergName,    setEmergName]    = useState('');
  const [emergPhone,   setEmergPhone]   = useState('');
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(null);

  useEffect(() => { if (memberId) loadMember(); }, [memberId]);

  async function loadMember() {
    setLoading(true);
    const { data } = await supabase.from('family_members').select('*').eq('id', memberId).single();
    if (data) {
      setMember(data);
      setFirstName(data.first_name);
      setLastName(data.last_name ?? '');
      setBirthDate(data.birth_date ?? '');
      setRelationship(data.relationship);
      setSex(data.sex ?? '');
      setBloodType(data.blood_type ?? '');
      setEpsName(data.eps_name ?? '');
      setAllergies(data.allergies ?? '');
      setConditions(data.chronic_conditions ?? '');
      setEmergName(data.emergency_contact_name ?? '');
      setEmergPhone(data.emergency_contact_phone ?? '');
      setAvatarUrl(data.avatar_url ?? null);
    }
    setLoading(false);
  }

  async function pickAndUploadAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permiso requerido', 'Necesitamos acceso a la galería.'); return; }

    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;

    setUploadingImg(true);
    try {
      const uri = result.assets[0].uri;
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      const filePath = `avatars/${tenant?.id}/${memberId}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(filePath, new Uint8Array(arrayBuffer), { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw new Error(upErr.message);

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      Alert.alert('Error al subir imagen', err.message);
    } finally {
      setUploadingImg(false);
    }
  }

  async function handleSave() {
    if (!firstName.trim()) { Alert.alert('Nombre requerido', 'El nombre es obligatorio.'); return; }

    setSaving(true);
    const { error } = await supabase
      .from('family_members')
      .update({
        first_name:              firstName.trim(),
        last_name:               lastName.trim() || null,
        birth_date:              birthDate || null,
        relationship,
        sex:                     sex || null,
        blood_type:              bloodType || null,
        eps_name:                epsName.trim() || null,
        allergies:               allergies.trim() || null,
        chronic_conditions:      conditions.trim() || null,
        emergency_contact_name:  emergName.trim() || null,
        emergency_contact_phone: emergPhone.trim() || null,
        avatar_url:              avatarUrl,
      })
      .eq('id', memberId);

    setSaving(false);
    if (error) { Alert.alert('Error al guardar', error.message); return; }

    await fetchMembers();
    Alert.alert('Guardado', 'Los datos del miembro fueron actualizados.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const relLabel = RELATIONSHIPS.find(r => r.value === relationship)?.label ?? relationship;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Editar miembro</Text>
          <Text style={styles.headerSub}>{member?.first_name}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.formWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickAndUploadAvatar} disabled={uploadingImg} activeOpacity={0.8}>
            <View style={styles.avatarWrap}>
              {uploadingImg
                ? <ActivityIndicator color={Colors.primary} />
                : avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                  : <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
                    </View>
              }
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={14} color={Colors.white} />
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Toca para cambiar la foto</Text>
        </View>

        {/* Datos básicos */}
        <SectionHeader title="Datos básicos" />
        <Field label="Nombre *" value={firstName} onChangeText={setFirstName} placeholder="Juan" autoCapitalize="words" />
        <Field label="Apellido" value={lastName} onChangeText={setLastName} placeholder="García" autoCapitalize="words" />
        <DatePickerField
          label="Fecha de nacimiento"
          value={birthDate}
          onChange={setBirthDate}
          placeholder="Selecciona la fecha"
          maximumDate={new Date()}
        />

        {/* Parentesco */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Parentesco</Text>
          <TouchableOpacity style={styles.select} onPress={() => setShowRelPicker(p => !p)}>
            <Text style={styles.selectText}>{relLabel}</Text>
            <Ionicons name={showRelPicker ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
          </TouchableOpacity>
          {showRelPicker && (
            <View style={styles.picker}>
              {RELATIONSHIPS.map(r => (
                <TouchableOpacity key={r.value} style={styles.pickerItem}
                  onPress={() => { setRelationship(r.value); setShowRelPicker(false); }}>
                  <Text style={[styles.pickerText, relationship === r.value && styles.pickerTextActive]}>{r.label}</Text>
                  {relationship === r.value && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Sexo */}
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Sexo</Text>
          <View style={styles.sexRow}>
            {(['M', 'F'] as const).map(s => (
              <TouchableOpacity key={s}
                style={[styles.sexBtn, sex === s && styles.sexBtnActive]}
                onPress={() => setSex(prev => prev === s ? '' : s)}>
                <Text style={[styles.sexText, sex === s && styles.sexTextActive]}>
                  {s === 'M' ? 'Masculino' : 'Femenino'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Datos médicos */}
        <SectionHeader title="Datos médicos" />
        <Field label="Tipo de sangre" value={bloodType} onChangeText={setBloodType} placeholder="O+, A-, B+..." />
        <Field label="EPS / Seguro médico" value={epsName} onChangeText={setEpsName} placeholder="Nueva EPS, Sura..." />
        <Field label="Alergias" value={allergies} onChangeText={setAllergies} placeholder="Penicilina, mariscos..." multiline />
        <Field label="Condiciones crónicas" value={conditions} onChangeText={setConditions} placeholder="Diabetes, hipertensión..." multiline />

        {/* Contacto de emergencia */}
        <SectionHeader title="Contacto de emergencia" />
        <Field label="Nombre" value={emergName} onChangeText={setEmergName} placeholder="María García" autoCapitalize="words" />
        <Field label="Teléfono" value={emergPhone} onChangeText={setEmergPhone} placeholder="+57 300 000 0000" keyboardType="phone-pad" />

        {/* Guardar */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave} disabled={saving} activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={styles.saveBtnText}>Guardar cambios</Text>
          }
        </TouchableOpacity>

        <View style={{ height: Spacing.xxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, multiline }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad'; autoCapitalize?: 'none' | 'words';
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false} multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
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
  backBtn: { width: 38, height: 38, backgroundColor: Colors.surface, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { alignItems: 'center', gap: 3 },
  headerTitle: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  headerSub: { color: Colors.textSecondary, fontSize: Typography.sm },

  formWrapper: { flex: 1 },
  content: { paddingHorizontal: Spacing.base, paddingTop: Spacing.xl, gap: Spacing.md },

  avatarSection: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, position: 'relative' },
  avatarImg: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.primary + '33', alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: Colors.primary, fontSize: Typography.xxl, fontWeight: Typography.bold },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.background,
  },
  avatarHint: { color: Colors.textMuted, fontSize: Typography.xs },

  sectionHeader: {
    color: Colors.textSecondary, fontSize: Typography.xs, fontWeight: Typography.bold,
    textTransform: 'uppercase', letterSpacing: 1,
    paddingTop: Spacing.sm,
  },
  fieldWrap: { gap: 6 },
  label: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  input: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 48,
    color: Colors.textPrimary, fontSize: Typography.base,
  },
  inputMulti: { height: 72, paddingTop: Spacing.sm },
  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 48,
  },
  selectText: { color: Colors.textPrimary, fontSize: Typography.base },
  picker: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pickerText: { color: Colors.textSecondary, fontSize: Typography.base },
  pickerTextActive: { color: Colors.textPrimary, fontWeight: Typography.semibold },
  sexRow: { flexDirection: 'row', gap: Spacing.sm },
  sexBtn: {
    flex: 1, height: 44, backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  sexBtnActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  sexText: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  sexTextActive: { color: Colors.primary },
  saveBtn: {
    height: 52, backgroundColor: Colors.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
  },
  saveBtnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
});
