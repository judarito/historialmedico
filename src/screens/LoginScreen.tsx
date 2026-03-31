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

interface LoginScreenProps {
  onLogin:        (email: string, password: string) => Promise<void>;
  onGoForgotPassword: () => void;
  onGoRegister:   () => void;
  onGoBack:       () => void;
  loading?:       boolean;
}

export function LoginScreen({ onLogin, onGoForgotPassword, onGoRegister, onGoBack, loading }: LoginScreenProps) {
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [emailError,  setEmailError]  = useState('');
  const [passError,   setPassError]   = useState('');

  function validate(): boolean {
    let ok = true;
    setEmailError('');
    setPassError('');

    if (!email.trim()) {
      setEmailError('Ingresa tu correo');
      ok = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Correo inválido');
      ok = false;
    }

    if (!password) {
      setPassError('Ingresa tu contraseña');
      ok = false;
    }

    return ok;
  }

  async function handleSubmit() {
    if (!validate()) return;
    await onLogin(email.trim(), password);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {/* Título */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Bienvenido</Text>
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            {/* Email */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Correo electrónico</Text>
              <View style={[styles.inputWrap, emailError ? styles.inputError : null]}>
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
                  returnKeyType="next"
                />
              </View>
              {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
            </View>

            {/* Password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Contraseña</Text>
              <View style={[styles.inputWrap, passError ? styles.inputError : null]}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPass}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
                <TouchableOpacity onPress={() => setShowPass(p => !p)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showPass ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={Colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              {passError ? <Text style={styles.errorText}>{passError}</Text> : null}
              <TouchableOpacity onPress={onGoForgotPassword} style={styles.forgotWrap} activeOpacity={0.8}>
                <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
              </TouchableOpacity>
            </View>

            {/* Botón */}
            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.submitText}>Iniciar sesión</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Registro */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>¿No tienes cuenta? </Text>
            <TouchableOpacity onPress={onGoRegister}>
              <Text style={styles.footerLink}>Crear cuenta</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
  },
  titleBlock: {
    marginBottom: Spacing.xxxl,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
  },

  // Form
  form: {
    gap: Spacing.lg,
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
  eyeBtn: {
    padding: Spacing.xs,
  },
  errorText: {
    color: Colors.alert,
    fontSize: Typography.xs,
    marginTop: 2,
  },

  // Submit
  submitBtn: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xxl,
  },
  footerText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  footerLink: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: Spacing.xs,
  },
  forgotText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
});
