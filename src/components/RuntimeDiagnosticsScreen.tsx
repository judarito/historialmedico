import { Share, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Typography } from '../theme';
import {
  formatDiagnosticsReport,
  getLatestErrorEntry,
  type RuntimeDiagnosticsReport,
} from '../services/runtimeDiagnostics';

interface RuntimeDiagnosticsScreenProps {
  title: string;
  subtitle: string;
  report: RuntimeDiagnosticsReport;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
}

export function RuntimeDiagnosticsScreen({
  title,
  subtitle,
  report,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: RuntimeDiagnosticsScreenProps) {
  async function handleShare() {
    const message = formatDiagnosticsReport(report);
    try {
      await Share.share({ message });
    } catch {
      // No-op
    }
  }

  const detailEntry = getLatestErrorEntry(report) ?? report.entries[0] ?? report.boot?.lastError ?? null;
  const detailMessage = detailEntry?.message ?? report.boot?.lastStep ?? 'No hay detalle disponible.';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Estado del arranque</Text>
          <Text style={styles.summaryValue}>{report.boot?.status ?? 'desconocido'}</Text>
          {!!report.boot?.lastStep && (
            <Text style={styles.summaryMeta}>Ultimo paso: {report.boot.lastStep}</Text>
          )}
          {!!detailEntry?.source && (
            <Text style={styles.summaryMeta}>Origen: {detailEntry.source}</Text>
          )}
        </View>

        <ScrollView style={styles.box} contentContainerStyle={styles.boxContent}>
          <Text style={styles.boxTitle}>Detalle</Text>
          <Text style={styles.errorMsg}>{detailMessage}</Text>
          {!!detailEntry?.extra && (
            <Text style={styles.meta}>{detailEntry.extra}</Text>
          )}
          {!!detailEntry?.stack && (
            <Text style={styles.stack}>{detailEntry.stack}</Text>
          )}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={handleShare}>
            <Text style={styles.btnSecondaryText}>Compartir reporte</Text>
          </TouchableOpacity>
          {primaryLabel && onPrimaryPress ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={onPrimaryPress}>
              <Text style={styles.btnPrimaryText}>{primaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {secondaryLabel && onSecondaryPress ? (
          <TouchableOpacity onPress={onSecondaryPress} style={styles.linkBtn}>
            <Text style={styles.linkText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    color: Colors.alert,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  summaryMeta: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  box: {
    flex: 1,
    backgroundColor: '#1A0A0A',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#E85D4A44',
  },
  boxContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  boxTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  errorMsg: {
    color: Colors.alert,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    fontFamily: 'monospace',
  },
  meta: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  stack: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  btnSecondaryText: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  btnPrimaryText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
  },
  linkText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
  },
});
