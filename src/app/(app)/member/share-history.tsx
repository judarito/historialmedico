import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../services/supabase';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../theme';
import { formatCalendarDate } from '../../../utils';

interface TtlOption {
  label: string;
  value: number;
}

interface ShareTokenResult {
  token: string;
  expires_at: string;
}

const TTL_OPTIONS: TtlOption[] = [
  { label: '24 horas', value: 24 },
  { label: '48 horas', value: 48 },
  { label: '7 días',   value: 168 },
];

export default function ShareHistoryScreen() {
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();

  const [selectedTtl, setSelectedTtl] = useState<number>(24);
  const [tokenData, setTokenData] = useState<ShareTokenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = tokenData ? Linking.createURL('/share/' + tokenData.token) : null;
  const displayName = memberName ?? 'miembro';

  async function handleGenerate() {
    setLoading(true);
    setTokenData(null);
    setCopied(false);
    try {
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_member_id: memberId as string,
        p_ttl_hours: selectedTtl,
      });
      if (error) throw error;
      setTokenData(data as ShareTokenResult);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      Alert.alert('Error al generar enlace', msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!shareUrl) return;
    try {
      await Share.share({
        url: shareUrl,
        message: `Historial de salud de ${displayName}: ${shareUrl}`,
      });
    } catch {
      // El usuario canceló
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Compartir historial de {displayName}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Info */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.info} />
          <Text style={styles.infoText}>
            El enlace permite que cualquier persona con acceso vea el historial{' '}
            <Text style={{ fontWeight: Typography.semibold }}>sin necesidad de cuenta</Text>.
          </Text>
        </View>

        {/* Selector de duración */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Duración del enlace</Text>
          <View style={styles.ttlOptions}>
            {TTL_OPTIONS.map(opt => {
              const selected = selectedTtl === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.ttlBtn, selected && styles.ttlBtnSelected]}
                  onPress={() => {
                    setSelectedTtl(opt.value);
                    setTokenData(null);
                    setCopied(false);
                  }}
                  activeOpacity={0.8}
                >
                  {selected && (
                    <Ionicons
                      name="radio-button-on"
                      size={16}
                      color={Colors.primary}
                      style={{ marginRight: Spacing.xs }}
                    />
                  )}
                  {!selected && (
                    <Ionicons
                      name="radio-button-off"
                      size={16}
                      color={Colors.textMuted}
                      style={{ marginRight: Spacing.xs }}
                    />
                  )}
                  <Text style={[styles.ttlBtnText, selected && styles.ttlBtnTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Botón generar */}
        <TouchableOpacity
          style={[styles.generateBtn, loading && { opacity: 0.7 }]}
          onPress={handleGenerate}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.textPrimary} />
          ) : (
            <Ionicons name="link" size={18} color={Colors.textPrimary} />
          )}
          <Text style={styles.generateBtnText}>
            {loading ? 'Generando...' : tokenData ? 'Generar nuevo enlace' : 'Generar enlace'}
          </Text>
        </TouchableOpacity>

        {/* Resultado */}
        {tokenData && shareUrl && (
          <View style={styles.resultCard}>
            {/* QR */}
            <View style={styles.qrWrapper}>
              <QRCode
                value={shareUrl}
                size={160}
                color={Colors.textPrimary}
                backgroundColor={Colors.surface}
              />
            </View>

            {/* URL */}
            <View style={styles.urlBox}>
              <Text style={styles.urlText} numberOfLines={3} selectable>
                {shareUrl}
              </Text>
            </View>

            {/* Expiración */}
            {tokenData.expires_at && (
              <View style={styles.expiryRow}>
                <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
                <Text style={styles.expiryText}>
                  Expira el{' '}
                  {formatCalendarDate(tokenData.expires_at, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}

            {/* Acciones */}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleShare} activeOpacity={0.85}>
              <Ionicons name="share-outline" size={18} color={Colors.textPrimary} />
              <Text style={styles.primaryBtnText}>Compartir</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, copied && styles.secondaryBtnCopied]}
              onPress={handleCopy}
              activeOpacity={0.85}
            >
              <Ionicons
                name={copied ? 'checkmark-done-outline' : 'copy-outline'}
                size={18}
                color={copied ? Colors.healthy : Colors.primary}
              />
              <Text style={[styles.secondaryBtnText, copied && { color: Colors.healthy }]}>
                {copied ? 'Copiado' : 'Copiar enlace'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Aviso de privacidad */}
        <View style={styles.privacyBox}>
          <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.privacyText}>
            Generar un nuevo enlace revoca el anterior automáticamente.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: Spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.infoBg ?? Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.info + '40',
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  infoText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    flex: 1,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    ...Shadow.subtle,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    marginBottom: Spacing.md,
  },
  ttlOptions: {
    gap: Spacing.sm,
  },
  ttlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  ttlBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '18',
  },
  ttlBtnText: {
    color: Colors.textSecondary,
    fontSize: Typography.base,
  },
  ttlBtnTextSelected: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    ...Shadow.subtle,
  },
  generateBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.base,
    marginBottom: Spacing.md,
    alignItems: 'center',
    ...Shadow.card,
  },
  qrWrapper: {
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  urlBox: {
    width: '100%',
    backgroundColor: Colors.background,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  urlText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontFamily: 'monospace',
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.base,
  },
  expiryText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.xxl,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    width: '100%',
    marginBottom: Spacing.sm,
  },
  primaryBtnText: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.xxl,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    width: '100%',
  },
  secondaryBtnCopied: {
    borderColor: Colors.healthy,
    backgroundColor: Colors.healthyBg ?? Colors.surface,
  },
  secondaryBtnText: {
    color: Colors.primary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  privacyText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    flex: 1,
  },
});
