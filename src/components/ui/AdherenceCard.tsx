import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { supabase } from '../../services/supabase';
import { Colors, Typography, Spacing, Radius } from '../../theme';

interface AdherenceCardProps {
  memberId: string;
}

interface Stats {
  taken: number;
  skipped: number;
  late: number;
}

const CIRCLE_SIZE = 64;
const STROKE_WIDTH = 5;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function monthLabel(date: Date): string {
  return date.toLocaleString('es-CO', { month: 'long' });
}

function colorForPct(pct: number): string {
  if (pct >= 80) return Colors.healthy;
  if (pct >= 50) return Colors.warning;
  return Colors.alert;
}

export function AdherenceCard({ memberId }: AdherenceCardProps) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const { data, error } = await supabase
        .from('medication_schedules')
        .select('status')
        .eq('family_member_id', memberId)
        .gte('scheduled_at', startOfMonth)
        .lte('scheduled_at', endOfMonth)
        .in('status', ['taken', 'skipped', 'late']);

      if (error || !data) return;

      const result: Stats = { taken: 0, skipped: 0, late: 0 };
      for (const row of data) {
        if (row.status === 'taken') result.taken++;
        else if (row.status === 'skipped') result.skipped++;
        else if (row.status === 'late') result.late++;
      }
      setStats(result);
    }

    load();
  }, [memberId]);

  if (!stats) return null;

  const total = stats.taken + stats.skipped + stats.late;
  if (total === 0) return null;

  const pct = Math.round((stats.taken / total) * 100);
  const color = colorForPct(pct);
  const dashOffset = CIRCUMFERENCE * (1 - pct / 100);
  const now = new Date();
  const month = monthLabel(now);
  // Capitalize first letter
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);

  return (
    <View style={styles.card}>
      {/* Círculo de progreso */}
      <View style={styles.circleContainer}>
        <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={styles.svg}>
          {/* Fondo */}
          <Circle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={RADIUS}
            stroke={Colors.border}
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {/* Progreso */}
          <Circle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={RADIUS}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </Svg>
        {/* Texto superpuesto */}
        <View style={styles.circleLabel}>
          <Text style={[styles.pctText, { color }]}>{pct}%</Text>
        </View>
      </View>

      {/* Texto derecho */}
      <View style={styles.textCol}>
        <Text style={styles.title}>Adherencia {monthCap}</Text>
        <Text style={styles.detail}>
          {stats.taken} tomadas · {stats.skipped + stats.late} saltadas
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  circleContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  svg: {
    transform: [{ rotate: '-90deg' }],
    position: 'absolute',
  },
  circleLabel: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pctText: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
  textCol: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textPrimary,
  },
  detail: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
  },
});
