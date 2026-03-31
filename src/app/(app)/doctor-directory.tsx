import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Linking,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  MedicalDirectoryService,
  type MedicalDirectoryPlace,
  type MedicalDirectorySearchResponse,
} from '../../services/medicalDirectory';
import { Colors, Typography, Spacing, Radius } from '../../theme';

const FEATURED_CITY_SLUGS = ['bogota', 'medellin', 'cartagena', 'barranquilla', 'cali', 'bucaramanga'];
const FEATURED_SPECIALTY_SLUGS = ['pediatria', 'cardiologia', 'neurologia', 'dermatologia', 'ginecologia', 'medicina-general'];

interface FilterOption {
  id: string;
  slug: string;
  name?: string;
  display_name?: string;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackBadgeLabel(place: MedicalDirectoryPlace): string | null {
  if (place.place_kind_label) return place.place_kind_label;
  if (!place.primary_type) return null;
  return place.primary_type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function DoctorDirectoryScreen() {
  const params = useLocalSearchParams<{ favorites?: string | string[] }>();
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<FilterOption[]>([]);
  const [specialties, setSpecialties] = useState<FilterOption[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingFavorites, setLoadingFavorites] = useState(true);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [results, setResults] = useState<MedicalDirectoryPlace[]>([]);
  const [favoritePlaces, setFavoritePlaces] = useState<MedicalDirectoryPlace[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [searchMeta, setSearchMeta] = useState<MedicalDirectorySearchResponse['meta'] | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const favoriteIdSet = new Set(favoriteIds);
  const favoritesParam = Array.isArray(params.favorites) ? params.favorites[0] : params.favorites;
  const openFavoritesDirectly = favoritesParam === '1' || favoritesParam === 'true';
  const cityNames = new Set(cities.map((city) => city.name));
  const selectedCityOption = cities.find((city) => city.slug === selectedCity) ?? null;
  const selectedSpecialtyOption = specialties.find((specialty) => specialty.slug === selectedSpecialty) ?? null;
  const hasActiveFavoriteFilters = Boolean(query.trim() || selectedCity || selectedSpecialty);

  useEffect(() => {
    void loadFilters();
    void loadFavorites();
  }, []);

  useEffect(() => {
    if (openFavoritesDirectly) {
      setFavoritesOnly(true);
    }
  }, [openFavoritesDirectly]);

  useFocusEffect(useCallback(() => {
    void loadFavorites();
  }, []));

  useEffect(() => {
    setResults((prev) => mergeFavoriteState(prev, favoriteIds));
    setFavoritePlaces((prev) => mergeFavoriteState(prev, favoriteIds));
  }, [favoriteIds]);

  async function loadFilters() {
    setLoadingFilters(true);
    try {
      const [citiesData, specialtiesData] = await Promise.all([
        MedicalDirectoryService.listCities(),
        MedicalDirectoryService.listSpecialties(),
      ]);
      setCities(citiesData);
      setSpecialties(specialtiesData);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'No se pudieron cargar los filtros');
    } finally {
      setLoadingFilters(false);
    }
  }

  async function loadFavorites() {
    setLoadingFavorites(true);
    try {
      const savedPlaces = await MedicalDirectoryService.listFavoritePlaces();
      setFavoritePlaces(savedPlaces);
      setFavoriteIds(savedPlaces.map((place) => place.id));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'No se pudieron cargar los guardados');
    } finally {
      setLoadingFavorites(false);
    }
  }

  function mergeFavoriteState(places: MedicalDirectoryPlace[], nextFavoriteIds: string[]) {
    const nextFavoriteSet = new Set(nextFavoriteIds);
    return places.map((place) => {
      const isFavorite = nextFavoriteSet.has(place.id);
      const fallbackBadge = fallbackBadgeLabel(place);
      const badgeLabels = Array.from(new Set([
        ...(isFavorite ? ['Favorito'] : []),
        ...(fallbackBadge ? [fallbackBadge] : []),
        ...((place.badge_labels ?? [])),
      ])).slice(0, 3);
      return {
        ...place,
        is_favorite: isFavorite,
        badge_labels: badgeLabels,
      };
    });
  }

  async function runSearch(nextPage = 1, pageToken: string | null = null) {
    if (favoritesOnly) {
      setLoadingSearch(true);
      setSearchError(null);
      setNextPageToken(null);
      setPage(1);
      setSearchMeta({
        cacheStatus: 'hit',
        googleCalled: false,
        stale: false,
        shouldRefresh: false,
        normalizedQuery: normalizeSearchText(query),
        searchMode: 'text',
        page: 1,
        pageSize: favoritePlaces.length,
        city: selectedCityOption?.name ? { slug: selectedCityOption.slug, name: selectedCityOption.name } : null,
        specialty: selectedSpecialtyOption?.display_name
          ? { slug: selectedSpecialtyOption.slug, displayName: selectedSpecialtyOption.display_name }
          : null,
        nextPageToken: null,
        warning: 'Mostrando solo tus lugares guardados.',
      });
      setLoadingSearch(false);
      return;
    }

    if (!query.trim() && !selectedCity && !selectedSpecialty) {
      setSearchError('Escribe una búsqueda o selecciona una ciudad/especialidad.');
      return;
    }

    setLoadingSearch(true);
    setSearchError(null);

    try {
      const response = await MedicalDirectoryService.search({
        query: query.trim(),
        citySlug: selectedCity ?? undefined,
        specialtySlug: selectedSpecialty ?? undefined,
        page: nextPage,
        pageToken,
      });

      setSearchMeta(response.meta);
      setNextPageToken(response.meta.nextPageToken ?? null);
      setPage(nextPage);
      const decoratedResults = mergeFavoriteState(response.results, favoriteIds);
      if (nextPage === 1) {
        setResults(decoratedResults);
      } else {
        setResults((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          const nextItems = decoratedResults.filter((item) => !seen.has(item.id));
          return [...prev, ...nextItems];
        });
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'No se pudo completar la búsqueda');
    } finally {
      setLoadingSearch(false);
    }
  }

  async function openInMaps(item: MedicalDirectoryPlace) {
    if (!item.google_maps_uri) return;
    await Linking.openURL(item.google_maps_uri);
  }

  function inferVisitSpecialty(item: MedicalDirectoryPlace): string {
    const selectedSpecialtyLabel = specialties.find((specialty) => specialty.slug === selectedSpecialty)?.display_name;
    if (selectedSpecialtyLabel) return selectedSpecialtyLabel;

    const blockedBadges = new Set([
      'Favorito',
      item.place_kind_label ?? '',
      fallbackBadgeLabel(item) ?? '',
      ...Array.from(cityNames),
    ]);

    const specialtyBadge = (item.badge_labels ?? []).find((badge) => !blockedBadges.has(badge));
    return specialtyBadge ?? '';
  }

  function createVisitFromPlace(item: MedicalDirectoryPlace) {
    const kindLabel = item.place_kind_label ?? fallbackBadgeLabel(item) ?? '';
    const isSpecialist = item.place_kind === 'specialist';

    router.push({
      pathname: '/(app)/add-visit',
      params: {
        doctorName: isSpecialist ? item.display_name : '',
        specialty: inferVisitSpecialty(item),
        institutionName: isSpecialist ? '' : item.display_name,
        sourcePlaceName: item.display_name,
        sourcePlaceKind: kindLabel,
      },
    });
  }

  function openDetails(item: MedicalDirectoryPlace) {
    router.push(`/(app)/doctor-place/${item.id}`);
  }

  async function toggleFavorite(item: MedicalDirectoryPlace) {
    const nextValue = !favoriteIdSet.has(item.id);

    try {
      await MedicalDirectoryService.setFavorite(item.id, nextValue);
      const nextFavoriteIds = nextValue
        ? [item.id, ...favoriteIds.filter((id) => id !== item.id)]
        : favoriteIds.filter((id) => id !== item.id);

      setFavoriteIds(nextFavoriteIds);
      setResults((prev) => mergeFavoriteState(prev, nextFavoriteIds));

      if (nextValue) {
        const favoritePlace = mergeFavoriteState([item], nextFavoriteIds)[0];
        setFavoritePlaces((prev) => {
          const rest = prev.filter((place) => place.id !== item.id);
          return [favoritePlace, ...rest];
        });
      } else {
        setFavoritePlaces((prev) => prev.filter((place) => place.id !== item.id));
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'No se pudo actualizar el favorito');
    }
  }

  const featuredCities = cities.filter((city) => FEATURED_CITY_SLUGS.includes(city.slug));
  const featuredSpecialties = specialties.filter((specialty) => FEATURED_SPECIALTY_SLUGS.includes(specialty.slug));
  const visibleResults = favoritesOnly
    ? favoritePlaces.filter((item) => {
        const searchableBag = normalizeSearchText([
          item.display_name,
          item.formatted_address ?? '',
          item.primary_type ?? '',
          ...(item.types ?? []),
          ...((item.badge_labels ?? [])),
        ].join(' '));
        const queryTokens = normalizeSearchText(query).split(' ').filter(Boolean);
        const matchesQuery = queryTokens.length === 0 || queryTokens.every((token) => searchableBag.includes(token));
        const matchesCity = !selectedCity || item.city_slug === selectedCity
          || (selectedCityOption?.name ? searchableBag.includes(normalizeSearchText(selectedCityOption.name)) : false);
        const matchesSpecialty = !selectedSpecialty
          || (selectedSpecialtyOption?.display_name
            ? searchableBag.includes(normalizeSearchText(selectedSpecialtyOption.display_name))
            : false);

        return matchesQuery && matchesCity && matchesSpecialty;
      })
    : results;
  const shouldShowSavedSection = !favoritesOnly && query.trim().length === 0 && !selectedCity && !selectedSpecialty && favoritePlaces.length > 0;

  function renderResult(item: MedicalDirectoryPlace) {
    return (
      <View key={item.id} style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <View style={styles.resultIcon}>
            <Ionicons name="medkit-outline" size={18} color={Colors.primary} />
          </View>
          <TouchableOpacity style={styles.resultBody} activeOpacity={0.8} onPress={() => openDetails(item)}>
            <Text style={styles.resultTitle}>{item.display_name}</Text>
            {!!item.formatted_address && (
              <Text style={styles.resultSubtitle}>{item.formatted_address}</Text>
            )}
            <View style={styles.resultMetaRow}>
              {(item.badge_labels ?? []).map((badge) => (
                <View key={`${item.id}:${badge}`} style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{badge}</Text>
                </View>
              ))}
              {typeof item.rating === 'number' && (
                <View style={styles.metaChip}>
                  <Ionicons name="star" size={11} color={Colors.warning} />
                  <Text style={styles.metaChipText}>{item.rating.toFixed(1)}</Text>
                </View>
              )}
              {typeof item.local_score === 'number' && (
                <View style={styles.metaChip}>
                  <Ionicons name="pulse-outline" size={11} color={Colors.info} />
                  <Text style={styles.metaChipText}>{item.local_score.toFixed(1)}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.resultActions}>
          <TouchableOpacity
            style={styles.favoriteBtn}
            onPress={() => { void toggleFavorite(item); }}
            activeOpacity={0.8}
          >
            <Ionicons
              name={favoriteIdSet.has(item.id) ? 'star' : 'star-outline'}
              size={18}
              color={favoriteIdSet.has(item.id) ? Colors.warning : Colors.textSecondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => createVisitFromPlace(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar-outline" size={15} color={Colors.primary} />
            <Text style={styles.actionBtnText}>Crear visita</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => openDetails(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="information-circle-outline" size={15} color={Colors.primary} />
            <Text style={styles.actionBtnText}>Detalle</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, !item.google_maps_uri && styles.actionBtnDisabled]}
            onPress={() => openInMaps(item)}
            disabled={!item.google_maps_uri}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate-outline" size={15} color={item.google_maps_uri ? Colors.primary : Colors.textMuted} />
            <Text style={[styles.actionBtnText, !item.google_maps_uri && styles.actionBtnTextDisabled]}>Mapa</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
      <View style={styles.headerText}>
        <Text style={styles.title}>Especialistas</Text>
        <Text style={styles.subtitle}>
          {openFavoritesDirectly ? 'Tus especialistas guardados' : 'Google Places + cache compartido'}
        </Text>
      </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.searchCard}>
          <Text style={styles.label}>¿Qué estás buscando?</Text>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Ej: pediatra, neurólogo, cardiólogo..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => { void runSearch(1); }}
            />
          </View>

          <View style={styles.quickToggleRow}>
            <TouchableOpacity
              style={[styles.favoritesToggleChip, favoritesOnly && styles.favoritesToggleChipActive]}
              onPress={() => setFavoritesOnly((current) => !current)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={favoritesOnly ? 'star' : 'star-outline'}
                size={12}
                color={favoritesOnly ? Colors.white : Colors.warning}
              />
              <Text style={[styles.favoritesToggleText, favoritesOnly && styles.favoritesToggleTextActive]}>
                Solo favoritos
              </Text>
            </TouchableOpacity>

            {favoriteIds.length > 0 && (
              <Text style={styles.quickToggleMeta}>
                {favoriteIds.length} guardado{favoriteIds.length === 1 ? '' : 's'}
              </Text>
            )}
          </View>

          <Text style={styles.label}>Ciudades rápidas</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {loadingFilters ? (
              <ActivityIndicator color={Colors.primary} />
            ) : featuredCities.map((city) => {
              const active = selectedCity === city.slug;
              return (
                <TouchableOpacity
                  key={city.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setSelectedCity(active ? null : city.slug)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{city.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Especialidades rápidas</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {loadingFilters ? (
              <ActivityIndicator color={Colors.primary} />
            ) : featuredSpecialties.map((specialty) => {
              const active = selectedSpecialty === specialty.slug;
              return (
                <TouchableOpacity
                  key={specialty.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setSelectedSpecialty(active ? null : specialty.slug)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {specialty.display_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.searchBtn, loadingSearch && styles.searchBtnDisabled]}
            onPress={() => { void runSearch(1); }}
            disabled={loadingSearch}
            activeOpacity={0.85}
          >
            {loadingSearch
              ? <ActivityIndicator color={Colors.white} />
              : <>
                  <Ionicons name="sparkles-outline" size={18} color={Colors.white} />
                  <Text style={styles.searchBtnText}>{favoritesOnly ? 'Filtrar guardados' : 'Buscar especialistas'}</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        {searchMeta?.warning && (
          <View style={styles.warningBar}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.warning} />
            <Text style={styles.warningText}>{searchMeta.warning}</Text>
          </View>
        )}

        {searchError && (
          <View style={styles.stateCard}>
            <Ionicons name="warning-outline" size={42} color={Colors.warning} />
            <Text style={styles.stateTitle}>No se pudo buscar</Text>
            <Text style={styles.stateText}>{searchError}</Text>
          </View>
        )}

        {!searchError && favoritesOnly && results.length === 0 && favoritePlaces.length === 0 && !loadingSearch && !loadingFavorites && (
          <View style={styles.stateCard}>
            <Ionicons name="star-outline" size={42} color={Colors.warning} />
            <Text style={styles.stateTitle}>Aún no tienes guardados</Text>
            <Text style={styles.stateText}>
              Guarda especialistas con la estrella para encontrarlos aquí desde Inicio o Perfil.
            </Text>
          </View>
        )}

        {!searchError && !favoritesOnly && results.length === 0 && favoritePlaces.length === 0 && !loadingSearch && (
          <View style={styles.stateCard}>
            <Ionicons name="location-outline" size={42} color={Colors.primary} />
            <Text style={styles.stateTitle}>Busca especialistas por ciudad</Text>
            <Text style={styles.stateText}>
              Puedes escribir libre, por ejemplo "pediatra en Cartagena", o combinar filtros rápidos.
            </Text>
          </View>
        )}

        {(results.length > 0 || (favoritesOnly && visibleResults.length > 0)) && (
          <View style={styles.resultsHeader}>
            <View style={styles.resultsHeaderLeft}>
              <Text style={styles.resultsTitle}>Resultados</Text>
              <TouchableOpacity
                style={[styles.favoritesToggleChip, favoritesOnly && styles.favoritesToggleChipActive]}
                onPress={() => setFavoritesOnly((current) => !current)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={favoritesOnly ? 'star' : 'star-outline'}
                  size={12}
                  color={favoritesOnly ? Colors.white : Colors.warning}
                />
                <Text style={[styles.favoritesToggleText, favoritesOnly && styles.favoritesToggleTextActive]}>
                  Solo favoritos
                </Text>
              </TouchableOpacity>
            </View>
            {favoritesOnly ? (
              <Text style={styles.resultsMeta}>guardados</Text>
            ) : searchMeta && (
              <Text style={styles.resultsMeta}>
                {searchMeta.cacheStatus === 'hit' ? 'cache' : searchMeta.cacheStatus}
              </Text>
            )}
          </View>
        )}

        {shouldShowSavedSection && (
          <View style={styles.savedSection}>
            <View style={styles.savedHeader}>
              <Text style={styles.savedTitle}>Tus guardados</Text>
              {loadingFavorites && <ActivityIndicator size="small" color={Colors.primary} />}
            </View>
            {favoritePlaces.map((item) => renderResult(item))}
          </View>
        )}

        {visibleResults.map((item) => renderResult(item))}

        {favoritesOnly && favoritePlaces.length > 0 && hasActiveFavoriteFilters && visibleResults.length === 0 && (
          <View style={styles.stateCard}>
            <Ionicons name="star-outline" size={42} color={Colors.warning} />
            <Text style={styles.stateTitle}>Sin coincidencias en guardados</Text>
            <Text style={styles.stateText}>Ninguno de tus lugares guardados coincide con esos filtros.</Text>
          </View>
        )}

        {!favoritesOnly && results.length > 0 && nextPageToken && (
          <TouchableOpacity
            style={[styles.loadMoreBtn, loadingSearch && styles.actionBtnDisabled]}
            onPress={() => { void runSearch(page + 1, nextPageToken); }}
            disabled={loadingSearch}
            activeOpacity={0.85}
          >
            {loadingSearch
              ? <ActivityIndicator color={Colors.primary} />
              : <Text style={styles.loadMoreText}>Cargar más</Text>
            }
          </TouchableOpacity>
        )}

        <View style={{ height: Spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
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
  headerText: { flex: 1, gap: 2 },
  title: { color: Colors.textPrimary, fontSize: Typography.xl, fontWeight: Typography.bold },
  subtitle: { color: Colors.textSecondary, fontSize: Typography.sm },
  content: {
    paddingHorizontal: Spacing.base,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  searchCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    marginTop: 2,
  },
  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 48,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.base,
  },
  chipsRow: {
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  chipTextActive: {
    color: Colors.white,
  },
  searchBtn: {
    height: 50,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  searchBtnDisabled: {
    opacity: 0.7,
  },
  searchBtnText: {
    color: Colors.white,
    fontSize: Typography.base,
    fontWeight: Typography.bold,
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
  stateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
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
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
  },
  resultsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  resultsTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  resultsMeta: {
    color: Colors.primary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    textTransform: 'capitalize',
  },
  quickToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    flexWrap: 'wrap',
  },
  quickToggleMeta: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  favoritesToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.warning + '44',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  favoritesToggleChipActive: {
    backgroundColor: Colors.warning,
    borderColor: Colors.warning,
  },
  favoritesToggleText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  favoritesToggleTextActive: {
    color: Colors.white,
  },
  savedSection: {
    gap: Spacing.sm,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
  },
  savedTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.md,
    fontWeight: Typography.bold,
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  resultHeader: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '15',
  },
  resultBody: { flex: 1, gap: 4 },
  resultTitle: {
    color: Colors.textPrimary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  resultSubtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.sm,
    lineHeight: 20,
  },
  resultMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 2,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  metaChipText: {
    color: Colors.textSecondary,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
  resultActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  favoriteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  actionBtnDisabled: {
    opacity: 0.55,
  },
  actionBtnText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  actionBtnTextDisabled: {
    color: Colors.textMuted,
  },
  loadMoreBtn: {
    alignSelf: 'center',
    minWidth: 140,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  loadMoreText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
  },
});
