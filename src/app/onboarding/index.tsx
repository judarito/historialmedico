import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';

export default function OnboardingCreateFamily() {
  const [name, setName]   = useState('');
  const [error, setError] = useState('');
  const { createTenantWithFamily, loading } = useFamilyStore();

  async function handleCreate() {
    if (!name.trim()) { setError('Ingresa el nombre de tu familia'); return; }
    setError('');
    const err = await createTenantWithFamily(name.trim());
    if (err) { Alert.alert('Error', err); return; }
    router.replace('/onboarding/member');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="people" size={56} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Crea tu grupo familiar</Text>
        <Text style={styles.subtitle}>
          Este es el espacio donde guardarás la salud de todos en tu familia.
          Puedes cambiar el nombre después.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Nombre del grupo</Text>
          <View style={[styles.inputWrap, error ? styles.inputErr : null]}>
            <Ionicons name="home-outline" size={18} color={Colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.input}
              placeholder="Familia García"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={styles.btnText}>Continuar</Text>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxxl * 1.5,
    alignItems: 'center',
  },
  iconWrap: {
    width: 100, height: 100,
    backgroundColor: Colors.surface,
    borderRadius: 50,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    color: Colors.textPrimary, fontSize: Typography.xxl,
    fontWeight: Typography.bold, textAlign: 'center',
    marginBottom: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary, fontSize: Typography.base,
    textAlign: 'center', lineHeight: 22,
    marginBottom: Spacing.xxxl,
  },
  field: { width: '100%', gap: Spacing.xs, marginBottom: Spacing.xl },
  label: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, height: 52,
  },
  inputErr: { borderColor: Colors.alert },
  input: { flex: 1, color: Colors.textPrimary, fontSize: Typography.base },
  errorText: { color: Colors.alert, fontSize: Typography.xs },
  btn: {
    width: '100%', height: 52, backgroundColor: Colors.primary,
    borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
});
