import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { supabase } from '../../services/supabase';
import { Colors, Typography, Spacing, Radius } from '../../theme';
import { VitalsChart } from './VitalsChart';

interface Props {
  memberId: string;
}

interface DataPoint {
  date: string;
  value: number;
}

interface VitalsData {
  weight: DataPoint[];
  temperature: DataPoint[];
  heartRate: DataPoint[];
  systolic: DataPoint[];
}

export function VitalsChartsSection({ memberId }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - 32 - 32;

  const [loading, setLoading] = useState(true);
  const [vitals, setVitals] = useState<VitalsData>({
    weight: [],
    temperature: [],
    heartRate: [],
    systolic: [],
  });

  useEffect(() => {
    async function fetchVitals() {
      setLoading(true);
      const { data, error } = await supabase
        .from('medical_visits')
        .select('visit_date, weight_kg, temperature_c, blood_pressure, heart_rate')
        .eq('family_member_id', memberId)
        .eq('status', 'completed')
        .is('deleted_at', null)
        .order('visit_date', { ascending: true })
        .limit(20);

      if (!error && data) {
        const weight: DataPoint[] = [];
        const temperature: DataPoint[] = [];
        const heartRate: DataPoint[] = [];
        const systolic: DataPoint[] = [];

        for (const row of data) {
          const date = row.visit_date as string;
          if (row.weight_kg != null) {
            weight.push({ date, value: row.weight_kg as number });
          }
          if (row.temperature_c != null) {
            temperature.push({ date, value: row.temperature_c as number });
          }
          if (row.heart_rate != null) {
            heartRate.push({ date, value: row.heart_rate as number });
          }
          if (row.blood_pressure) {
            const parts = (row.blood_pressure as string).split('/');
            const sys = parseInt(parts[0], 10);
            if (!isNaN(sys)) {
              systolic.push({ date, value: sys });
            }
          }
        }

        setVitals({ weight, temperature, heartRate, systolic });
      }

      setLoading(false);
    }

    fetchVitals();
  }, [memberId]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const charts = [
    { data: vitals.weight, color: Colors.primary, label: 'Peso', unit: 'kg' },
    { data: vitals.temperature, color: Colors.alert, label: 'Temperatura', unit: '°C' },
    { data: vitals.heartRate, color: Colors.healthy, label: 'Frecuencia cardíaca', unit: 'bpm' },
    { data: vitals.systolic, color: Colors.warning, label: 'Presión sistólica', unit: 'mmHg' },
  ].filter((c) => c.data.length >= 2);

  if (charts.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Tendencias de salud</Text>
      <View style={styles.chartsContainer}>
        {charts.map((c) => (
          <VitalsChart
            key={c.label}
            data={c.data}
            color={c.color}
            label={c.label}
            unit={c.unit}
            width={chartWidth}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  section: {
    gap: Spacing.base,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: '600',
  },
  chartsContainer: {
    gap: Spacing.base,
  },
});
