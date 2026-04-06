import { useEffect, useState } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { Colors, Typography, Spacing, Radius } from '../../theme';

function normalizePhoneInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[^\d+]/g, '');
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }

  const digitsOnly = normalized.replace(/\D/g, '');
  if (!normalized.startsWith('+') && /^3\d{9}$/.test(digitsOnly)) {
    normalized = `+57${digitsOnly}`;
  }

  if (!/^\+\d{8,15}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export default function OnboardingContactScreen() {
  const { user } = useAuthStore();
  const { fetchTenantAndFamily, fetchMembers } = useFamilyStore();
  const [phone, setPhone] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function prepareContactStep() {
      await fetchTenantAndFamily();
      if (!active) return;

      const familyState = useFamilyStore.getState();
      if (!familyState.tenant?.id || !familyState.family?.id) {
        router.replace('/onboarding');
        return;
      }

      await familyState.fetchMembers();
      if (!active) return;

      const nextState = useFamilyStore.getState();
      if (nextState.members.length === 0) {
        router.replace('/onboarding/member');
        return;
      }

      if (!user?.id) {
        router.replace('/login');
        return;
      }

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .maybeSingle();

      if (!active) return;

      if (profileError) {
        Alert.alert('No pudimos cargar tu perfil', profileError.message);
        setCheckingAccess(false);
        return;
      }

      const existingPhone = data?.phone?.trim() ?? '';
      if (existingPhone) {
        router.replace('/(app)/(tabs)');
        return;
      }

      setPhone(existingPhone);
      setCheckingAccess(false);
    }

    void prepareContactStep();
    return () => {
      active = false;
    };
  }, [fetchMembers, fetchTenantAndFamily, user?.id]);

  async function handleSave() {
    if (!user?.id) return;

    const normalizedPhone = normalizePhoneInput(phone);
    if (!normalizedPhone) {
      setError('Ingresa un celular válido en formato internacional, por ejemplo +573001112233.');
      return;
    }

    setError('');
    setSaving(true);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ phone: normalizedPhone })
      .eq('id', user.id);
    setSaving(false);

    if (updateError) {
      Alert.alert('No pudimos guardar el celular', updateError.message);
      return;
    }

    router.replace('/(app)/(tabs)');
  }

  if (checkingAccess) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Preparando tu contacto...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.titleBlock}>
            <Ionicons name="logo-whatsapp" size={40} color={Colors.primary} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.title}>Agrega tu celular</Text>
            <Text style={styles.subtitle}>
              Lo usaremos para pruebas por WhatsApp y para futuros recordatorios externos. Guárdalo en formato internacional.
            </Text>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Celular *</Text>
            <View style={[styles.inputWrap, error ? styles.inputErr : null]}>
              <TextInput
                style={styles.input}
                placeholder="+57 300 111 2233"
                placeholderTextColor={Colors.textMuted}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <View style={styles.helpCard}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
            <Text style={styles.helpText}>
              Ejemplo recomendado: +573001112233. Si escribes un móvil colombiano como 3001112233, lo convertiremos automáticamente a +57.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, saving && styles.btnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.btnText}>Guardar y continuar</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.base,
    paddingHorizontal: Spacing.xl,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.lg,
  },
  titleBlock: { alignItems: 'center', marginBottom: Spacing.md },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  fieldWrap: { gap: Spacing.xs },
  label: { color: Colors.textSecondary, fontSize: Typography.sm, fontWeight: Typography.medium },
  inputWrap: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
    justifyContent: 'center',
  },
  inputErr: { borderColor: Colors.alert },
  input: { color: Colors.textPrimary, fontSize: Typography.base },
  errorText: { color: Colors.alert, fontSize: Typography.xs },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  helpText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  btn: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: Colors.white, fontSize: Typography.md, fontWeight: Typography.bold },
});
