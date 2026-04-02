import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Colors, Typography, Spacing, Radius } from '../../theme';

interface DataPoint {
  date: string;
  value: number;
}

interface VitalsChartProps {
  data: DataPoint[];
  color: string;
  label: string;
  unit: string;
  minY?: number;
  maxY?: number;
  width?: number;
  height?: number;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function VitalsChart({
  data,
  color,
  label,
  unit,
  minY: minYProp,
  maxY: maxYProp,
  width = 280,
  height = 100,
}: VitalsChartProps) {
  if (data.length < 2) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={styles.emptyText}>{label}: Sin datos suficientes</Text>
      </View>
    );
  }

  const values = data.map((d) => d.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const margin = (dataMax - dataMin) * 0.1 || 1;
  const minY = minYProp ?? dataMin - margin;
  const maxY = maxYProp ?? dataMax + margin;

  const paddingH = 8;
  const paddingV = 12;
  const chartW = width - paddingH * 2;
  const chartH = height - paddingV * 2;

  const toX = (i: number) => paddingH + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => paddingV + chartH - ((v - minY) / (maxY - minY)) * chartH;

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const areaPoints = [
    `${toX(0)},${paddingV + chartH}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${paddingV + chartH}`,
  ].join(' ');

  const lastValue = data[data.length - 1].value;
  const gradientId = `grad_${label.replace(/\s+/g, '_')}`;

  // Índices de etiquetas del eje X: primero, último y (si ≥5) el del medio
  const labelIndices = new Set<number>([0, data.length - 1]);
  if (data.length >= 5) {
    labelIndices.add(Math.floor((data.length - 1) / 2));
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{label}</Text>
        <Text style={[styles.headerValue, { color }]}>
          {lastValue} {unit}
        </Text>
      </View>

      {/* SVG */}
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.3" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Polygon points={areaPoints} fill={`url(#${gradientId})`} />

        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((d, i) => (
          <Circle
            key={i}
            cx={toX(i)}
            cy={toY(d.value)}
            r={4}
            fill={color}
            stroke={Colors.surface}
            strokeWidth={2}
          />
        ))}
      </Svg>

      {/* Eje X */}
      <View style={[styles.xAxis, { width }]}>
        {data.map((d, i) =>
          labelIndices.has(i) ? (
            <Text
              key={i}
              style={[
                styles.axisLabel,
                {
                  position: 'absolute',
                  left: toX(i) - 20,
                  width: 40,
                  textAlign: 'center',
                },
              ]}
            >
              {formatDateLabel(d.date)}
            </Text>
          ) : null
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
  headerValue: {
    fontSize: Typography.sm,
    fontWeight: '700',
  },
  xAxis: {
    height: 16,
    position: 'relative',
  },
  axisLabel: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
});
