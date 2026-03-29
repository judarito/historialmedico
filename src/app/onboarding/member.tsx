import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { DatePickerField } from '../../components/ui/DatePickerField';
import type { Database } from '../../types/database.types';

type RelType = Database['public']['Tables']['family_members']['Row']['relationship'];

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
  { value: 'other',       label: 'Otro' },
];

export default function OnboardingAddMember() {
  const { addMember, loading } = useFamilyStore();

  const [firstName,     setFirstName]     = useState('');
  const [lastName,      setLastName]      = useState('');
  const [birthDate,     setBirthDate]     = useState('');
  const [relationship,  setRelationship]  = useState<RelType>('self');
  const [sex,           setSex]           = useState<'M' | 'F' | ''>('');
  const [epsName,       setEpsName]       = useState('');
  const [showRelPicker, setShowRelPicker] = useState(false);
  const [errors,        setErrors]        = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'Campo requerido';
    if (!birthDate.trim()) e.birthDate = 'Selecciona la fecha de nacimiento';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleAdd() {
    if (!validate()) return;
    const err = await addMember({
      first_name:   firstName.trim(),
      last_name:    lastName.trim(),
      birth_date:   birthDate,
      relationship,
      sex:          sex || undefined,
      eps_name:     epsName.trim() || undefined,
    });
    if (err) { Alert.alert('Error', err); return; }
    router.replace('/(app)/(tabs)');
  }

  const relLabel = RELATIONSHIPS.find(r => r.value === relationship)?.label ?? relationship;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleBlock}>
          <Ionicons name="person-add" size={40} color={Colors.primary} style={{ marginBottom: Spacing.md }} />
          <Text style={styles.title}>Agrega el primer miembro</Text>
          <Text style={styles.subtitle}>Puedes agregar más miembros después desde la app.</Text>
        </View>

        <Field label="Nombre *" value={firstName} onChangeText={setFirstName}
          placeholder="Juan" autoCapitalize="words" error={errors.firstName} />
        <Field label="Apellido" value={lastName} onChangeText={setLastName}
          placeholder="García" autoCapitalize="words" />
        <DatePickerField
          label="Fecha de nacimiento *"
          value={birthDate}
          onChange={setBirthDate}
          placeholder="Selecciona la fecha"
          error={errors.birthDate}
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
                <TouchableOpacity key={r.value} style={styles.pickerItem} onPress={() => { setRelationship(r.value); setShowRelPicker(false); }}>
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
              <TouchableOpacity
                key={s}
                style={[styles.sexBtn, sex === s && styles.sexBtnActive]}
                onPress={() => setSex(prev => prev === s ? '' : s)}
              >
                <Text style={[styles.sexText, sex === s && styles.sexTextActive]}>
                  {s === 'M' ? 'Masculino' : 'Femenino'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Field label="EPS / Seguro médico" value={epsName} onChangeText={setEpsName}
          placeholder="Nueva EPS, Sura, Sanitas..." />

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={handleAdd} disabled={loading} activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={styles.btnText}>Empezar</Text>
          }
        </TouchableOpacity>

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, error, keyboardType, autoCapitalize }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; error?: string;
  keyboardType?: 'default' | 'numeric';
  autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputErr : null]}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
        />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xxl, gap: Spacing.lg },
  titleBlock: { alignItems: 'center', marginBottom: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold, textAlign: 'center', marginBottom: 6 },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.sm, textAlign: 'center' },
  fieldWrap: { gap: Spacing.xs },
  label: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  inputWrap: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 52, justifyContent: 'center',
  },
  inputErr: { borderColor: Colors.alert },
  input: { color: Colors.textPrimary, fontSize: Typography.base },
  errorText: { color: Colors.alert, fontSize: Typography.xs },
  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 52,
  },
  selectText: { color: Colors.textPrimary, fontSize: Typography.base },
  picker: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  pickerText: { color: Colors.textSecondary, fontSize: Typography.base },
  pickerTextActive: { color: Colors.textPrimary, fontWeight: Typography.semibold },
  sexRow: { flexDirection: 'row', gap: Spacing.sm },
  sexBtn: { flex: 1, height: 44, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  sexBtnActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  sexText: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  sexTextActive: { color: Colors.primary },
  btn: { height: 52, backgroundColor: Colors.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  btnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
});
