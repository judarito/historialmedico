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

interface UpdatePasswordScreenProps {
  onSubmit: (password: string) => Promise<void>;
  onGoBack: () => void;
  loading?: boolean;
  canEdit?: boolean;
}

export function UpdatePasswordScreen({
  onSubmit,
  onGoBack,
  loading,
  canEdit = true,
}: UpdatePasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');

  function validate() {
    let valid = true;
    setPasswordError('');
    setConfirmError('');

    if (!password) {
      setPasswordError('Ingresa una contraseña');
      valid = false;
    } else if (password.length < 6) {
      setPasswordError('Mínimo 6 caracteres');
      valid = false;
    }

    if (!confirmPassword) {
      setConfirmError('Confirma tu contraseña');
      valid = false;
    } else if (confirmPassword !== password) {
      setConfirmError('Las contraseñas no coinciden');
      valid = false;
    }

    return valid;
  }

  async function handleSubmit() {
    if (!canEdit || !validate()) return;
    await onSubmit(password);
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
            <Text style={styles.title}>Nueva contraseña</Text>
            <Text style={styles.subtitle}>
              {canEdit
                ? 'Ingresa la nueva contraseña para seguir entrando a tu cuenta.'
                : 'Abre el enlace de recuperación desde tu correo para poder cambiar la contraseña.'}
            </Text>
          </View>

          <PasswordField
            label="Nueva contraseña"
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 6 caracteres"
            secureTextEntry={!showPassword}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((current) => !current)}
            error={passwordError}
            editable={canEdit}
          />

          <PasswordField
            label="Confirmar contraseña"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repite la contraseña"
            secureTextEntry={!showConfirm}
            showPassword={showConfirm}
            onTogglePassword={() => setShowConfirm((current) => !current)}
            error={confirmError}
            editable={canEdit}
            onSubmitEditing={handleSubmit}
          />

          <TouchableOpacity
            style={[styles.submitBtn, (!canEdit || loading) && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!canEdit || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.submitText}>Guardar nueva contraseña</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  showPassword,
  onTogglePassword,
  error,
  editable,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry: boolean;
  showPassword: boolean;
  onTogglePassword: () => void;
  error?: string;
  editable?: boolean;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null, !editable ? styles.inputDisabled : null]}>
        <Ionicons name="lock-closed-outline" size={18} color={Colors.textSecondary} style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
        />
        <TouchableOpacity onPress={onTogglePassword} style={styles.eyeBtn} disabled={!editable}>
          <Ionicons
            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>
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
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxxl,
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
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
  inputDisabled: {
    opacity: 0.7,
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
  },
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
});
