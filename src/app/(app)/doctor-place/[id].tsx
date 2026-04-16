import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  MedicalDirectoryService,
  type MedicalDirectoryPlace,
  type MedicalDirectoryDetailsResponse,
} from '../../../services/medicalDirectory';
import { Colors, Typography, Spacing, Radius } from '../../../theme';

function weekdayDescriptionsFromHours(hours: unknown): string[] {
  if (!hours || typeof hours !== 'object') return [];
  const maybeDescriptions = (hours as { weekdayDescriptions?: unknown }).weekdayDescriptions;
  return Array.isArray(maybeDescriptions)
    ? maybeDescriptions.filter((item): item is string => typeof item === 'string')
    : [];
}

function openNowFromHours(hours: unknown): boolean | null {
  if (!hours || typeof hours !== 'object') return null;
  const value = (hours as { openNow?: unknown }).openNow;
  return typeof value === 'boolean' ? value : null;
}

function inferVisitSpecialty(details: MedicalDirectoryPlace | null): string {
  if (!details) return '';

  const blockedBadges = new Set([
    'Favorito',
    details.place_kind_label ?? '',
  ]);

  return (details.badge_labels ?? []).find((badge) => !blockedBadges.has(badge)) ?? '';
}

export default function DoctorPlaceDetailsScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    memberId?: string | string[];
    memberName?: string | string[];
    mode?: string | string[];
    defaultFuture?: string | string[];
    visitDate?: string | string[];
    doctorName?: string | string[];
    specialty?: string | string[];
    institutionName?: string | string[];
    reasonForVisit?: string | string[];
    diagnosis?: string | string[];
    notes?: string | string[];
    weightKg?: string | string[];
    heightCm?: string | string[];
    temperatureC?: string | string[];
    bloodPressure?: string | string[];
    heartRate?: string | string[];
    showOptionalDetails?: string | string[];
    showVitals?: string | string[];
  }>();
  const placeId = typeof params.id === 'string' ? params.id : '';

  function getReturnParam(key: keyof typeof params): string {
    const value = params[key];
    return typeof value === 'string' ? value : '';
  }

  function buildAddVisitContext() {
    return {
      memberId: getReturnParam('memberId'),
      memberName: getReturnParam('memberName'),
      mode: getReturnParam('mode'),
      defaultFuture: getReturnParam('defaultFuture'),
      visitDate: getReturnParam('visitDate'),
      doctorName: getReturnParam('doctorName'),
      specialty: getReturnParam('specialty'),
      institutionName: getReturnParam('institutionName'),
      reasonForVisit: getReturnParam('reasonForVisit'),
      diagnosis: getReturnParam('diagnosis'),
      notes: getReturnParam('notes'),
      weightKg: getReturnParam('weightKg'),
      heightCm: getReturnParam('heightCm'),
      temperatureC: getReturnParam('temperatureC'),
      bloodPressure: getReturnParam('bloodPressure'),
      heartRate: getReturnParam('heartRate'),
      showOptionalDetails: getReturnParam('showOptionalDetails'),
      showVitals: getReturnParam('showVitals'),
    };
  }

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [details, setDetails] = useState<MedicalDirectoryPlace | null>(null);
  const [meta, setMeta] = useState<MedicalDirectoryDetailsResponse['meta'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);

  useEffect(() => {
    if (!placeId) {
      setLoading(false);
      setError('No se recibió un lugar válido.');
      return;
    }

    void loadDetails(false);
  }, [placeId]);

  async function loadDetails(forceRefresh: boolean) {
    if (!placeId) return;

    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await MedicalDirectoryService.getPlaceDetails(placeId, forceRefresh);
      setDetails(response.place);
      setMeta(response.meta);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo cargar el detalle');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function openUrl(url: string | null | undefined) {
    if (!url) return;
    await Linking.openURL(url);
  }

  async function callPhone(phone: string | null | undefined) {
    if (!phone) return;
    const cleaned = phone.replace(/\s+/g, '');
    await Linking.openURL(`tel:${cleaned}`);
  }

  async function toggleFavorite() {
    if (!details) return;
    setSavingFavorite(true);
    try {
      const nextValue = await MedicalDirectoryService.setFavorite(details.id, !details.is_favorite);
      setDetails((current) => {
        if (!current) return current;
        const nextBadges = Array.from(new Set([
          ...(nextValue ? ['Favorito'] : []),
          ...((current.badge_labels ?? []).filter((badge) => badge !== 'Favorito')),
        ]));
        return {
          ...current,
          is_favorite: nextValue,
          badge_labels: nextBadges,
        };
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo actualizar el favorito');
    } finally {
      setSavingFavorite(false);
    }
  }

  function createVisitFromPlace() {
    if (!details) return;

    const isSpecialist = details.place_kind === 'specialist';
    router.push({
      pathname: '/(app)/add-visit',
      params: {
        ...buildAddVisitContext(),
        doctorName: isSpecialist ? details.display_name : '',
        specialty: inferVisitSpecialty(details),
        institutionName: isSpecialist ? '' : details.display_name,
        sourcePlaceName: details.display_name,
        sourcePlaceKind: details.place_kind_label ?? '',
      },
    });
  }

  const regularHours = weekdayDescriptionsFromHours(details?.regular_opening_hours);
  const openNow = openNowFromHours(details?.current_opening_hours);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>Detalle del lugar</Text>
          <Text style={styles.headerSubtitle}>Campos ricos cargados bajo demanda</Text>
        </View>
        <TouchableOpacity
          style={[styles.favoriteBtn, savingFavorite && styles.refreshBtnDisabled]}
          onPress={() => { void toggleFavorite(); }}
          disabled={savingFavorite || !details}
        >
          <Ionicons
            name={details?.is_favorite ? 'star' : 'star-outline'}
            size={18}
            color={details?.is_favorite ? Colors.warning : Colors.textSecondary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
          onPress={() => { void loadDetails(true); }}
          disabled={refreshing}
        >
          {refreshing
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
          }
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.stateCenter}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.stateText}>Cargando detalle del especialista...</Text>
        </View>
      ) : error ? (
        <View style={styles.stateCenter}>
          <Ionicons name="warning-outline" size={44} color={Colors.warning} />
          <Text style={styles.stateTitle}>No se pudo abrir la ficha</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { void loadDetails(false); }}>
            <Text style={styles.retryBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : !details ? (
        <View style={styles.stateCenter}>
          <Ionicons name="location-outline" size={44} color={Colors.textMuted} />
          <Text style={styles.stateTitle}>Lugar no disponible</Text>
          <Text style={styles.stateText}>No encontramos más información para este resultado.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {meta?.warning ? (
            <View style={styles.warningBar}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.warning} />
              <Text style={styles.warningText}>{meta.warning}</Text>
            </View>
          ) : null}

          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              <Ionicons name="medkit-outline" size={22} color={Colors.primary} />
            </View>
            <Text style={styles.placeName}>{details.display_name}</Text>
            {!!details.formatted_address && (
              <Text style={styles.placeAddress}>{details.formatted_address}</Text>
            )}
            <View style={styles.heroMeta}>
              {(details.badge_labels ?? []).map((badge) => (
                <View key={badge} style={styles.heroChip}>
                  <Text style={styles.heroChipText}>{badge}</Text>
                </View>
              ))}
              {typeof details.rating === 'number' && (
                <View style={styles.heroChip}>
                  <Ionicons name="star" size={12} color={Colors.warning} />
                  <Text style={styles.heroChipText}>
                    {details.rating.toFixed(1)}
                    {typeof details.user_rating_count === 'number' ? ` (${details.user_rating_count})` : ''}
                  </Text>
                </View>
              )}
              {typeof details.local_score === 'number' && (
                <View style={styles.heroChip}>
                  <Ionicons name="pulse-outline" size={12} color={Colors.info} />
                  <Text style={styles.heroChipText}>{details.local_score.toFixed(1)}</Text>
                </View>
              )}
              {openNow !== null && (
                <View style={[styles.heroChip, openNow ? styles.heroChipHealthy : styles.heroChipMuted]}>
                  <Text style={[styles.heroChipText, openNow ? styles.heroChipHealthyText : styles.heroChipMutedText]}>
                    {openNow ? 'Abierto ahora' : 'Cerrado ahora'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={createVisitFromPlace}
            >
              <Ionicons name="calendar-outline" size={18} color={Colors.white} />
              <Text style={styles.actionBtnPrimaryText}>Crear visita</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, !details.national_phone && !details.international_phone && styles.actionBtnDisabled]}
              disabled={!details.national_phone && !details.international_phone}
              onPress={() => { void callPhone(details.national_phone ?? details.international_phone); }}
            >
              <Ionicons name="call-outline" size={18} color={Colors.primary} />
              <Text style={styles.actionBtnText}>Llamar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, !details.website_uri && styles.actionBtnDisabled]}
              disabled={!details.website_uri}
              onPress={() => { void openUrl(details.website_uri); }}
            >
              <Ionicons name="globe-outline" size={18} color={Colors.primary} />
              <Text style={styles.actionBtnText}>Sitio web</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, !details.google_maps_uri && styles.actionBtnDisabled]}
              disabled={!details.google_maps_uri}
              onPress={() => { void openUrl(details.google_maps_uri); }}
            >
              <Ionicons name="navigate-outline" size={18} color={Colors.primary} />
              <Text style={styles.actionBtnText}>Mapa</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Contacto</Text>
            <InfoRow icon="call-outline" label="Teléfono" value={details.national_phone ?? details.international_phone ?? 'No disponible'} />
            <InfoRow icon="link-outline" label="Sitio web" value={details.website_uri ?? 'No disponible'} />
            <InfoRow icon="location-outline" label="Dirección" value={details.formatted_address ?? 'No disponible'} />
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Horarios</Text>
            {regularHours.length > 0 ? (
              regularHours.map((line) => (
                <Text key={line} style={styles.hoursLine}>{line}</Text>
              ))
            ) : (
              <Text style={styles.placeholderText}>Google no devolvió horarios detallados para este lugar.</Text>
            )}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.sectionTitle}>Estado del cache</Text>
            <InfoRow icon="flash-outline" label="Origen" value={meta?.cacheStatus ?? 'desconocido'} />
            <InfoRow icon="cloud-outline" label="Google consultado" value={meta?.googleCalled ? 'Sí' : 'No'} />
            <InfoRow icon="shield-checkmark-outline" label="Business status" value={details.business_status ?? 'No disponible'} />
            <InfoRow icon="star-outline" label="Favorito" value={details.is_favorite ? 'Sí' : 'No'} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={16} color={Colors.primary} />
      </View>
      <View style={styles.infoBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.base,
    paddingBottom: Spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerBody: { flex: 1, gap: 2 },
  headerTitle: { color: Colors.textPrimary, fontSize: Typography.lg, fontWeight: Typography.bold },
  headerSubtitle: { color: Colors.textSecondary, fontSize: Typography.xs },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
  },
  favoriteBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshBtnDisabled: { opacity: 0.6 },
  stateCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  stateTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    textAlign: 'center',
  },
  stateText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryBtnText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.md,
  },
  warningBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  warningText: {
    flex: 1,
    color: Colors.warning,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '15',
  },
  placeName: {
    color: Colors.textPrimary,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
  },
  placeAddress: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 22,
  },
  heroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  heroChipText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  heroChipHealthy: {
    backgroundColor: Colors.healthyBg,
  },
  heroChipHealthyText: {
    color: Colors.healthy,
  },
  heroChipMuted: {
    backgroundColor: Colors.border,
  },
  heroChipMutedText: {
    color: Colors.textMuted,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  actionBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  actionBtnPrimaryText: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  infoRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  infoBody: { flex: 1, gap: 2 },
  infoLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  infoValue: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 21,
  },
  hoursLine: {
    color: Colors.textPrimary,
    fontSize: Typography.sm,
    lineHeight: 22,
  },
  placeholderText: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 22,
  },
});
