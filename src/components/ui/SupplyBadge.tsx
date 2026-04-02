import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../../theme';

interface SupplyBadgeProps {
  end_at: string | null;
}

export function SupplyBadge({ end_at }: SupplyBadgeProps) {
  if (end_at === null) return null;

  const days = Math.ceil(
    (new Date(end_at).getTime() - Date.now()) / 86400000,
  );

  if (days > 7) return null;

  let color: string;
  let bgColor: string;
  let label: string;

  if (days < 0) {
    color = Colors.alert;
    bgColor = Colors.alertBg;
    label = 'Vencido';
  } else if (days === 0) {
    color = Colors.alert;
    bgColor = Colors.alertBg;
    label = 'Hoy vence';
  } else if (days <= 3) {
    color = Colors.alert;
    bgColor = Colors.alertBg;
    label = `${days} días`;
  } else {
    // 4–7
    color = Colors.warning;
    bgColor = Colors.warningBg;
    label = `${days} días`;
  }

  return (
    <View style={[styles.badge, { backgroundColor: bgColor, borderColor: color }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    lineHeight: 14,
  },
});
