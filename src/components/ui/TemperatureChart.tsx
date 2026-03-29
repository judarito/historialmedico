// Gráfico de temperatura — versión sin dependencias externas
// Usa SVG nativo de react-native-svg (incluido en Expo)
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Defs, LinearGradient, Stop, Polygon } from 'react-native-svg';
import { Colors, Typography, Spacing } from '../../theme';

interface DataPoint {
  time: string;
  value: number;
}

interface TemperatureChartProps {
  data: DataPoint[];
  minY?: number;
  maxY?: number;
  width?: number;
  height?: number;
}

export function TemperatureChart({
  data,
  minY = 35,
  maxY = 41,
  width = 300,
  height = 120,
}: TemperatureChartProps) {
  const paddingH = 8;
  const paddingV = 12;
  const chartW   = width  - paddingH * 2;
  const chartH   = height - paddingV * 2;

  const toX = (i: number) => paddingH + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => paddingV + chartH - ((v - minY) / (maxY - minY)) * chartH;

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  // Área rellena: cierra el polígono por los bordes del chart
  const areaPoints = [
    `${toX(0)},${paddingV + chartH}`,
    ...data.map((d, i) => `${toX(i)},${toY(d.value)}`),
    `${toX(data.length - 1)},${paddingV + chartH}`,
  ].join(' ');

  const yLabels = [maxY, (maxY + minY) / 2, minY];

  return (
    <View style={styles.container}>
      {/* Labels eje Y */}
      <View style={[styles.yLabels, { height }]}>
        {yLabels.map((v, i) => (
          <Text key={i} style={styles.axisLabel}>{v}°</Text>
        ))}
      </View>

      {/* SVG Chart */}
      <View style={{ flex: 1 }}>
        <Svg width="100%" height={height}>
          <Defs>
            <LinearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0"   stopColor={Colors.alert} stopOpacity="0.35" />
              <Stop offset="1"   stopColor={Colors.alert} stopOpacity="0"    />
            </LinearGradient>
          </Defs>

          {/* Área bajo la curva */}
          <Polygon
            points={areaPoints}
            fill="url(#tempGrad)"
          />

          {/* Línea */}
          <Polyline
            points={points}
            fill="none"
            stroke={Colors.alert}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Puntos */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={toX(i)}
              cy={toY(d.value)}
              r={4}
              fill={Colors.alert}
              stroke={Colors.surface}
              strokeWidth={2}
            />
          ))}
        </Svg>

        {/* Labels eje X */}
        <View style={styles.xLabels}>
          {data.map((d, i) => (
            <Text key={i} style={styles.axisLabel}>{d.time}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yLabels: {
    width: 32,
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  xLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginTop: 4,
  },
  axisLabel: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
});
