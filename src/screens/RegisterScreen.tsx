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
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../theme';

interface RegisterScreenProps {
  onRegister:   (email: string, password: string, fullName: string) => Promise<void>;
  onGoLogin:    () => void;
  onGoBack:     () => void;
  loading?:     boolean;
}

export function RegisterScreen({ onRegister, onGoLogin, onGoBack, loading }: RegisterScreenProps) {
  const [fullName,      setFullName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [confirmPass,   setConfirmPass]   = useState('');
  const [showPass,      setShowPass]      = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);

  const [nameError,    setNameError]    = useState('');
  const [emailError,   setEmailError]   = useState('');
  const [passError,    setPassError]    = useState('');
  const [confirmError, setConfirmError] = useState('');

  function validate(): boolean {
    let ok = true;
    setNameError(''); setEmailError(''); setPassError(''); setConfirmError('');

    if (!fullName.trim()) {
      setNameError('Ingresa tu nombre'); ok = false;
    }

    if (!email.trim()) {
      setEmailError('Ingresa tu correo'); ok = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError('Correo inválido'); ok = false;
    }

    if (!password) {
      setPassError('Ingresa una contraseña'); ok = false;
    } else if (password.length < 6) {
      setPassError('Mínimo 6 caracteres'); ok = false;
    }

    if (!confirmPass) {
      setConfirmError('Confirma tu contraseña'); ok = false;
    } else if (confirmPass !== password) {
      setConfirmError('Las contraseñas no coinciden'); ok = false;
    }

    return ok;
  }

  async function handleSubmit() {
    if (!validate()) return;
    await onRegister(email.trim(), password, fullName.trim());
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Título */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Crear cuenta</Text>
            <Text style={styles.subtitle}>Si te invitaron a una familia, usa ese mismo correo. Si no, luego podrás crear tu propio grupo familiar.</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            {/* Nombre */}
            <Field
              label="Nombre completo"
              icon="person-outline"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Tu nombre"
              error={nameError}
              autoCapitalize="words"
            />

            {/* Email */}
            <Field
              label="Correo electrónico"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="tu@correo.com"
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            {/* Password */}
            <Field
              label="Contraseña"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="Mínimo 6 caracteres"
              error={passError}
              secureTextEntry={!showPass}
              showToggle
              toggleShow={showPass}
              onToggle={() => setShowPass(p => !p)}
            />

            {/* Confirm */}
            <Field
              label="Confirmar contraseña"
              icon="lock-closed-outline"
              value={confirmPass}
              onChangeText={setConfirmPass}
              placeholder="Repite la contraseña"
              error={confirmError}
              secureTextEntry={!showConfirm}
              showToggle
              toggleShow={showConfirm}
              onToggle={() => setShowConfirm(p => !p)}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.submitText}>Crear cuenta</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Login */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Ya tienes cuenta? </Text>
            <TouchableOpacity onPress={onGoLogin}>
              <Text style={styles.footerLink}>Iniciar sesión</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: Spacing.xxxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Campo reutilizable ────────────────────────────────────────
interface FieldProps {
  label:            string;
  icon:             React.ComponentProps<typeof Ionicons>['name'];
  value:            string;
  onChangeText:     (t: string) => void;
  placeholder?:     string;
  error?:           string;
  keyboardType?:    'default' | 'email-address';
  autoCapitalize?:  'none' | 'words' | 'sentences';
  secureTextEntry?: boolean;
  showToggle?:      boolean;
  toggleShow?:      boolean;
  onToggle?:        () => void;
  returnKeyType?:   'next' | 'done';
  onSubmitEditing?: () => void;
}

function Field({
  label, icon, value, onChangeText, placeholder, error,
  keyboardType = 'default', autoCapitalize = 'none',
  secureTextEntry, showToggle, toggleShow, onToggle,
  returnKeyType, onSubmitEditing,
}: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null]}>
        <Ionicons name={icon} size={18} color={Colors.textSecondary} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secureTextEntry}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
        />
        {showToggle && (
          <TouchableOpacity onPress={onToggle} style={styles.eyeBtn}>
            <Ionicons
              name={toggleShow ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
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
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  titleBlock: {
    marginBottom: Spacing.xxl,
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
    lineHeight: 22,
  },

  form: { gap: Spacing.lg },
  fieldWrap: { gap: Spacing.xs },
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
  inputError: { borderColor: Colors.alert },
  inputIcon: { marginRight: Spacing.sm },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  eyeBtn: { padding: Spacing.xs },
  errorText: {
    color: Colors.alert,
    fontSize: Typography.xs,
    marginTop: 2,
  },

  submitBtn: {
    height: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: {
    color: Colors.white,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xxl,
  },
  footerText: { color: Colors.textSecondary, fontSize: Typography.sm },
  footerLink: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
});
