import React from 'react';
import { View, Text, Image, StyleSheet, ImageSourcePropType } from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../theme';

interface StatCardProps {
  icon: ImageSourcePropType;    // usa assets reales de la imagen
  iconBg: string;
  label: string;
  value: string;
  sublabel: string;
  sublabelColor?: string;
}

export function StatCard({ icon, iconBg, label, value, sublabel, sublabelColor }: StatCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Image source={icon} style={styles.iconImg} />
      </View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={[styles.sublabel, { color: sublabelColor ?? Colors.textSecondary }]}>{sublabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.subtle,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  iconImg: {
    width: 26,
    height: 26,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    marginBottom: 2,
  },
  value: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    marginBottom: 2,
  },
  sublabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
});
