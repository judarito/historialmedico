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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFamilyStore } from '../../../store/familyStore';
import { Avatar } from '../../../components/ui/Avatar';
import { Colors, Typography, Spacing, Radius } from '../../../theme';
import type { Database } from '../../../types/database.types';

type RelType = Database['public']['Tables']['family_members']['Row']['relationship'];

const REL_LABELS: Record<RelType, string> = {
  self: 'Yo', spouse: 'Cónyuge', son: 'Hijo', daughter: 'Hija',
  father: 'Padre', mother: 'Madre', brother: 'Hermano', sister: 'Hermana',
  grandfather: 'Abuelo', grandmother: 'Abuela', guardian: 'Tutor', other: 'Otro',
};

export default function FamilyTab() {
  const { members, loading, fetchMembers, addMember } = useFamilyStore();
  const [showAdd, setShowAdd]       = useState(false);
  const [firstName, setFirstName]   = useState('');
  const [lastName, setLastName]     = useState('');
  const [birthDate, setBirthDate]   = useState('');
  const [rel, setRel]               = useState<RelType>('other');
  const [saving, setSaving]         = useState(false);

  useEffect(() => { fetchMembers(); }, []);

  async function handleAdd() {
    if (!firstName.trim() || !birthDate.trim()) {
      Alert.alert('Campos requeridos', 'Nombre y fecha de nacimiento son obligatorios.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      Alert.alert('Formato incorrecto', 'Usa el formato AAAA-MM-DD para la fecha.');
      return;
    }
    setSaving(true);
    const err = await addMember({ first_name: firstName.trim(), last_name: lastName.trim(), birth_date: birthDate, relationship: rel });
    setSaving(false);
    if (err) { Alert.alert('Error', err); return; }
    setShowAdd(false);
    setFirstName(''); setLastName(''); setBirthDate(''); setRel('other');
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Mi Familia</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.searchBtn} onPress={() => router.push('/(app)/search')}>
            <Ionicons name="search-outline" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={22} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      {loading && members.length === 0
        ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        : (
          <ScrollView contentContainerStyle={styles.list}>
            {members.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Aún no hay miembros.{'\n'}Toca + para agregar.</Text>
              </View>
            )}
            {members.map(m => (
              <TouchableOpacity key={m.id} style={styles.card} onPress={() => router.push(`/(app)/member/${m.id}`)} activeOpacity={0.7}>
                <Avatar name={m.first_name} imageUrl={m.avatar_url} size={48} />
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{m.first_name} {m.last_name ?? ''}</Text>
                  <Text style={styles.cardRel}>{REL_LABELS[m.relationship] ?? m.relationship}</Text>
                  {m.eps_name && <Text style={styles.cardEps}>{m.eps_name}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )
      }

      {/* Modal agregar miembro */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalBox}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Nuevo miembro</Text>
                  <TouchableOpacity onPress={() => setShowAdd(false)}>
                    <Ionicons name="close" size={22} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <MiniField label="Nombre *" value={firstName} onChangeText={setFirstName} placeholder="Juan" autoCapitalize="words" />
                <MiniField label="Apellido" value={lastName} onChangeText={setLastName} placeholder="García" autoCapitalize="words" />
                <MiniField label="Fecha nacimiento * (AAAA-MM-DD)" value={birthDate} onChangeText={setBirthDate} placeholder="1990-05-21" keyboardType="numeric" />

                <TouchableOpacity
                  style={[styles.modalBtn, saving && { opacity: 0.6 }]}
                  onPress={handleAdd} disabled={saving} activeOpacity={0.8}
                >
                  {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.modalBtnText}>Agregar</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MiniField({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'numeric'; autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={{ gap: 4, marginBottom: Spacing.sm }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={Colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.base, paddingBottom: Spacing.md,
  },
  title: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  searchBtn: {
    width: 38, height: 38, backgroundColor: Colors.surface,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  addBtn: {
    width: 38, height: 38, backgroundColor: Colors.primary,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
  },
  list: { paddingHorizontal: Spacing.base, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  cardInfo: { flex: 1, gap: 3 },
  cardName: { color: Colors.textPrimary, fontSize: Typography.base, fontWeight: Typography.semibold },
  cardRel: { color: Colors.textSecondary, fontSize: Typography.sm },
  cardEps: { color: Colors.textMuted, fontSize: Typography.xs },
  empty: { alignItems: 'center', marginTop: 80, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base, textAlign: 'center', lineHeight: 22 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalKeyboard: { flex: 1, justifyContent: 'flex-end' },
  modalScroll: { flexGrow: 0 },
  modalScrollContent: { justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.xl, paddingBottom: Spacing.xxxl,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xl },
  modalTitle: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  fieldLabel: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  fieldInput: {
    backgroundColor: Colors.background, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 48,
    color: Colors.textPrimary, fontSize: Typography.base,
  },
  modalBtn: {
    height: 52, backgroundColor: Colors.primary, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md,
  },
  modalBtnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
});
