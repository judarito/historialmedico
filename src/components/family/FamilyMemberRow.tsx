import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../ui/Avatar';
import { Colors, Typography, Spacing, Radius } from '../../theme';

type HealthStatus = 'alert' | 'warning' | 'healthy' | 'neutral';

interface FamilyMemberRowProps {
  name: string;
  statusText: string;
  status: HealthStatus;
  avatarUrl?: string | null;
  onPress: () => void;
}

const STATUS_COLOR: Record<HealthStatus, string> = {
  alert:   Colors.alert,
  warning: Colors.warning,
  healthy: Colors.healthy,
  neutral: Colors.textSecondary,
};

export function FamilyMemberRow({
  name,
  statusText,
  status,
  avatarUrl,
  onPress,
}: FamilyMemberRowProps) {
  const statusColor = STATUS_COLOR[status];

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Avatar
        name={name}
        imageUrl={avatarUrl}
        size={46}
        statusColor={statusColor}
      />
      <View style={styles.info}>
        <Text style={styles.name}>{name}</Text>
        <Text style={[styles.status, { color: statusColor }]}>{statusText}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  status: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
});
