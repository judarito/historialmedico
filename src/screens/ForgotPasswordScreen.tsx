import React, { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../theme';

interface ForgotPasswordScreenProps {
  onSubmit: (email: string) => Promise<void>;
  onGoBack: () => void;
  loading?: boolean;
}

export function ForgotPasswordScreen({ onSubmit, onGoBack, loading }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  function validate() {
    if (!email.trim()) {
      setError('Ingresa tu correo');
      return false;
    }

    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      setError('Correo inválido');
      return false;
    }

    setError('');
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    await onSubmit(email.trim().toLowerCase());
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Recuperar contraseña</Text>
            <Text style={styles.subtitle}>
              Te enviaremos un enlace para crear una nueva contraseña en tu cuenta.
            </Text>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Correo electrónico</Text>
            <View style={[styles.inputWrap, error ? styles.inputError : null]}>
              <Ionicons name="mail-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="tu@correo.com"
                placeholderTextColor={Colors.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.submitText}>Enviar enlace</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
  },
  backBtn: {
    width: 40,
    height: 40,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxxl,
    gap: Spacing.xl,
  },
  titleBlock: {
    gap: Spacing.sm,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    lineHeight: 22,
  },
  fieldWrap: {
    gap: Spacing.xs,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  inputError: {
    borderColor: Colors.alert,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  errorText: {
    color: Colors.alert,
    fontSize: Typography.xs,
  },
  submitBtn: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
});
