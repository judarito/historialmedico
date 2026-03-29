// ============================================================
// Pantalla 3: Detalle de Familiar — "Mateo / Monitoreo de Salud"
// Alert card, recomendaciones, gráfico de temperatura
// ============================================================
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TemperatureChart } from '../components/ui/TemperatureChart';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';

interface VitalAlert {
  label:   string;
  value:   string;
  icon:    keyof typeof Ionicons.glyphMap;
  color:   string;
}

interface MemberDetailScreenProps {
  name:             string;
  alertTitle?:      string;     // ej. "Fiebre Alta" — null si está saludable
  vitals?:          VitalAlert[];
  recommendations?: string[];
  temperatureData?: { time: string; value: number }[];
  onBack:           () => void;
}

export function MemberDetailScreen({
  name,
  alertTitle,
  vitals      = [],
  recommendations = [],
  temperatureData = [],
  onBack,
}: MemberDetailScreenProps) {
  const { width } = useWindowDimensions();
  const chartWidth = width - Spacing.base * 2 - 40; // descontar padding + yLabels

  const hasAlert = !!alertTitle;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header con back */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName}>{name}</Text>
          <Text style={styles.headerSub}>Monitoreo de Salud</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Card de alerta */}
        {hasAlert && (
          <View style={styles.alertCard}>
            {/* Título de alerta */}
            <View style={styles.alertTitleRow}>
              <View style={styles.alertDot} />
              <Text style={styles.alertTitle}>{alertTitle}</Text>
            </View>

            {/* Vitales */}
            {vitals.map((v, i) => (
              <View key={i} style={styles.vitalRow}>
                <View style={[styles.vitalIconWrap, { backgroundColor: v.color + '22' }]}>
                  <Ionicons name={v.icon} size={18} color={v.color} />
                </View>
                <Text style={styles.vitalLabel}>{v.label}:</Text>
                <Text style={[styles.vitalValue, { color: v.color }]}>{v.value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Recomendaciones */}
        {recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recomendaciones</Text>
            <View style={styles.recoCard}>
              {recommendations.map((rec, i) => (
                <View key={i} style={styles.recoRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={Colors.healthy}
                    style={{ marginTop: 1 }}
                  />
                  <Text style={styles.recoText}>{rec}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Gráfico de temperatura */}
        {temperatureData.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Temperatura</Text>
            <View style={styles.chartCard}>
              <TemperatureChart
                data={temperatureData}
                width={chartWidth}
                height={130}
                minY={35}
                maxY={41}
              />
            </View>
          </View>
        )}

        {/* Estado saludable (cuando no hay alerta) */}
        {!hasAlert && (
          <View style={styles.healthyCard}>
            <Ionicons name="shield-checkmark" size={40} color={Colors.healthy} />
            <Text style={styles.healthyTitle}>Todo en orden</Text>
            <Text style={styles.healthyText}>No hay alertas activas para este familiar.</Text>
          </View>
        )}

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
    gap: 3,
  },
  headerName: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
  },
  headerSub: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },

  scroll: { flex: 1 },
  content: {
    padding: Spacing.base,
    gap: Spacing.base,
  },

  // Alert card
  alertCard: {
    backgroundColor: Colors.alertBg,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.alert + '44',
    gap: Spacing.md,
    ...Shadow.card,
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.alert,
  },
  alertTitle: {
    color: Colors.alert,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  vitalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  vitalIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vitalLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    flex: 1,
  },
  vitalValue: {
    fontSize: Typography.base,
    fontWeight: Typography.bold,
  },

  // Sección
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },

  // Recomendaciones
  recoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
    gap: Spacing.md,
  },
  recoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  recoText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    flex: 1,
    lineHeight: 20,
  },

  // Gráfico
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.base,
  },

  // Estado saludable
  healthyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.healthy + '33',
  },
  healthyTitle: {
    color: Colors.healthy,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
  },
  healthyText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
    textAlign: 'center',
  },
});
