import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { Colors, Typography, Radius, Spacing } from '../../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'outline' | 'ghost';
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'solid',
  color = Colors.primary,
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isSolid   = variant === 'solid';
  const isOutline = variant === 'outline';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        styles.base,
        isSolid   && { backgroundColor: Colors.surfaceHigh },
        isOutline && { backgroundColor: Colors.transparent, borderWidth: 1.5, borderColor: Colors.white },
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={Colors.white} size="small" />
      ) : (
        <Text style={[styles.label, isOutline && { color: Colors.white }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  label: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.5,
  },
});
