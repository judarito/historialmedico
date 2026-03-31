// ============================================================
// Edge Function: search-medical-places
// Google Places como fuente inicial + Supabase como cache
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const LOCK_TTL_SECONDS = 90;
const POLL_WAIT_MS = 900;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SearchMode = "city" | "nearby" | "text";
type CacheStatus = "hit" | "stale" | "refreshed" | "processing" | "error";
type PlaceKind = "specialist" | "clinic" | "hospital" | "laboratory" | "pharmacy" | "health_service";

interface SearchMedicalPlacesRequest {
  query?: string;
  citySlug?: string;
  specialtySlug?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  page?: number;
  pageSize?: number;
  pageToken?: string | null;
  forceRefresh?: boolean;
  includeRichFields?: boolean;
}

interface CityRow {
  id: string;
  slug: string;
  name: string;
  department: string | null;
  centroid_lat: number;
  centroid_lng: number;
  search_aliases: string[] | null;
}

interface SpecialtyRow {
  id: string;
  slug: string;
  display_name: string;
  search_aliases: string[] | null;
}

interface DirectoryPlaceRow {
  id: string;
  google_place_id: string;
  display_name: string;
  formatted_address: string | null;
  national_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  primary_type: string | null;
  types: string[] | null;
  rating: number | null;
  user_rating_count: number | null;
  google_maps_uri: string | null;
  business_status: string | null;
  city_slug: string | null;
  source_rank?: number | null;
  local_score?: number;
  match_flags?: string[];
  place_kind?: PlaceKind;
  place_kind_label?: string;
  badge_labels?: string[];
  is_favorite?: boolean;
}

interface SearchCacheRow {
  id: string;
  status: string;
  expires_at: string | null;
  google_next_page_token: string | null;
  result_count: number;
  hit_count: number;
  refresh_token: string | null;
}

interface SearchCacheResultRow {
  place_id: string;
  result_rank: number;
  source_rank: number | null;
}

interface ClaimRefreshRow {
  cache_id: string;
  refresh_token: string;
  acquired: boolean;
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  nationalPhoneNumber?: string;
}

interface SearchResponse {
  results: DirectoryPlaceRow[];
  meta: {
    cacheStatus: CacheStatus;
    googleCalled: boolean;
    stale: boolean;
    shouldRefresh: boolean;
    normalizedQuery: string;
    searchMode: SearchMode;
    page: number;
    pageSize: number;
    city: { slug: string; name: string } | null;
    specialty: { slug: string; displayName: string } | null;
    nextPageToken: string | null;
    retryAfterMs?: number;
    warning?: string;
  };
}

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isMissingFavoritesTableError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return error?.code === "PGRST205" && haystack.includes("medical_directory_favorites");
}

let lookupCache:
  | {
      loadedAt: number;
      cities: CityRow[];
      specialties: SpecialtyRow[];
    }
  | null = null;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWholePhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  const target = ` ${haystack} `;
  return target.includes(` ${phrase} `);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadLookups() {
  if (lookupCache && Date.now() - lookupCache.loadedAt < LOOKUP_CACHE_TTL_MS) {
    return lookupCache;
  }

  const [{ data: cities, error: citiesError }, { data: specialties, error: specialtiesError }] = await Promise.all([
    adminSupabase
      .from("medical_directory_cities")
      .select("id, slug, name, department, centroid_lat, centroid_lng, search_aliases")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    adminSupabase
      .from("medical_directory_specialties")
      .select("id, slug, display_name, search_aliases")
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
  ]);

  if (citiesError) throw citiesError;
  if (specialtiesError) throw specialtiesError;

  lookupCache = {
    loadedAt: Date.now(),
    cities: (cities ?? []) as CityRow[],
    specialties: (specialties ?? []) as SpecialtyRow[],
  };

  return lookupCache;
}

function findCity(queryNormalized: string, citySlug: string | undefined, cities: CityRow[]): CityRow | null {
  if (citySlug) {
    return cities.find((city) => city.slug === citySlug) ?? null;
  }

  const candidates = cities.flatMap((city) => {
    const aliases = new Set<string>([
      normalizeText(city.name),
      ...((city.search_aliases ?? []).map(normalizeText)),
    ]);
    return Array.from(aliases).map((alias) => ({ city, alias }));
  });

  candidates.sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => hasWholePhrase(queryNormalized, alias))?.city ?? null;
}

function findSpecialty(
  queryNormalized: string,
  specialtySlug: string | undefined,
  specialties: SpecialtyRow[]
): SpecialtyRow | null {
  if (specialtySlug) {
    return specialties.find((specialty) => specialty.slug === specialtySlug) ?? null;
  }

  const candidates = specialties.flatMap((specialty) => {
    const aliases = new Set<string>([
      normalizeText(specialty.display_name),
      ...((specialty.search_aliases ?? []).map(normalizeText)),
    ]);
    return Array.from(aliases).map((alias) => ({ specialty, alias }));
  });

  candidates.sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => hasWholePhrase(queryNormalized, alias))?.specialty ?? null;
}

function inferSearchMode(
  queryNormalized: string,
  city: CityRow | null,
  latitude?: number,
  longitude?: number
): SearchMode {
  const wantsNearby = hasWholePhrase(queryNormalized, "cerca de mi")
    || hasWholePhrase(queryNormalized, "cerca de mí")
    || hasWholePhrase(queryNormalized, "near me");

  if (wantsNearby && isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
    return "nearby";
  }
  if (city) return "city";
  if (isFiniteNumber(latitude) && isFiniteNumber(longitude) && !queryNormalized) {
    return "nearby";
  }
  return "text";
}

function buildGoogleTextQuery(
  rawQuery: string,
  searchMode: SearchMode,
  city: CityRow | null,
  specialty: SpecialtyRow | null
): string {
  const trimmed = rawQuery.trim();
  const normalized = normalizeText(trimmed);
  const onlyNearbyPrompt = normalized === "cerca de mi"
    || normalized === "cerca de mí"
    || normalized === "near me";

  if (trimmed && !onlyNearbyPrompt) {
    return trimmed;
  }

  const specialtyText = specialty?.display_name ?? "medico especialista";
  if (searchMode === "city" && city) {
    return `${specialtyText} en ${city.name} Colombia`;
  }
  if (searchMode === "nearby") {
    return `${specialtyText} cerca de mi`;
  }
  if (city) {
    return `${specialtyText} en ${city.name} Colombia`;
  }
  return `${specialtyText} en Colombia`;
}

function buildCacheKey(params: {
  normalizedQuery: string;
  searchMode: SearchMode;
  city: CityRow | null;
  specialty: SpecialtyRow | null;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  page: number;
  includeRichFields: boolean;
}): string {
  const parts = ["country:co", `mode:${params.searchMode}`];
  if (params.city) parts.push(`city:${params.city.slug}`);
  if (params.specialty) parts.push(`specialty:${params.specialty.slug}`);

  if (params.searchMode === "nearby" && isFiniteNumber(params.latitude) && isFiniteNumber(params.longitude)) {
    parts.push(`cell:${params.latitude.toFixed(2)},${params.longitude.toFixed(2)}`);
    parts.push(`radius:${Math.round(params.radiusMeters ?? 5000)}`);
  } else if (params.normalizedQuery) {
    parts.push(`query:${params.normalizedQuery}`);
  }

  parts.push(`page:${params.page}`);
  parts.push(`rich:${params.includeRichFields ? 1 : 0}`);
  return parts.join("|");
}

function getCacheTtlHours(searchMode: SearchMode, resultCount: number): number {
  if (resultCount === 0) return 6;
  if (searchMode === "nearby") return 6;
  return 24;
}

function getFieldMask(includeRichFields: boolean): string {
  const baseFields = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.primaryType",
    "places.types",
    "places.googleMapsUri",
    "places.businessStatus",
    "nextPageToken",
  ];

  if (includeRichFields) {
    baseFields.splice(baseFields.length - 1, 0, "places.rating", "places.userRatingCount", "places.nationalPhoneNumber");
  }

  return baseFields.join(",");
}

function buildLocationBias(
  searchMode: SearchMode,
  city: CityRow | null,
  latitude?: number,
  longitude?: number,
  radiusMeters?: number
) {
  if (searchMode === "nearby" && isFiniteNumber(latitude) && isFiniteNumber(longitude)) {
    return {
      circle: {
        center: { latitude, longitude },
        radius: Math.min(Math.max(radiusMeters ?? 5000, 1000), 50000),
      },
    };
  }

  if (city) {
    return {
      circle: {
        center: {
          latitude: Number(city.centroid_lat),
          longitude: Number(city.centroid_lng),
        },
        radius: 30000,
      },
    };
  }

  return undefined;
}

function placeTextBag(place: Pick<DirectoryPlaceRow, "display_name" | "formatted_address" | "primary_type" | "types">): string {
  return normalizeText([
    place.display_name,
    place.formatted_address,
    place.primary_type,
    ...(place.types ?? []),
  ].filter(Boolean).join(" "));
}

function getPlaceKind(place: Pick<DirectoryPlaceRow, "display_name" | "primary_type" | "types">): {
  kind: PlaceKind;
  label: string;
} {
  const types = new Set((place.types ?? []).map((type) => normalizeText(type)));
  const primaryType = normalizeText(place.primary_type ?? "");
  const name = normalizeText(place.display_name);

  if (types.has("hospital") || primaryType === "hospital" || name.includes("hospital")) {
    return { kind: "hospital", label: "Hospital" };
  }

  if (
    types.has("medical_clinic")
    || primaryType === "medical_clinic"
    || name.includes("clinica")
    || name.includes("clínica")
  ) {
    return { kind: "clinic", label: "Clínica" };
  }

  if (
    types.has("doctor")
    || primaryType === "doctor"
    || name.includes("consultorio")
    || name.includes("medico")
    || name.includes("médico")
    || name.includes("dr ")
    || name.includes("dra ")
  ) {
    return {
      kind: name.includes("consultorio") ? "clinic" : "specialist",
      label: name.includes("consultorio") ? "Consultorio" : "Especialista",
    };
  }

  if (
    types.has("medical_lab")
    || primaryType === "medical_lab"
    || name.includes("laboratorio")
  ) {
    return { kind: "laboratory", label: "Laboratorio" };
  }

  if (types.has("pharmacy") || primaryType === "pharmacy" || name.includes("farmacia") || name.includes("drogueria")) {
    return { kind: "pharmacy", label: "Farmacia" };
  }

  return { kind: "health_service", label: "Servicio de salud" };
}

function countAliasMatches(value: string, aliases: string[]): number {
  return aliases.reduce((count, alias) => count + (hasWholePhrase(value, alias) ? 1 : 0), 0);
}

function computeLocalScore(params: {
  place: DirectoryPlaceRow;
  queryNormalized: string;
  city: CityRow | null;
  specialty: SpecialtyRow | null;
  sourceRank: number;
  isFavorite: boolean;
}): { score: number; flags: string[]; kind: PlaceKind; kindLabel: string; badges: string[] } {
  const { place, queryNormalized, city, specialty, sourceRank, isFavorite } = params;
  const bag = placeTextBag(place);
  const { kind, label: kindLabel } = getPlaceKind(place);
  const flags: string[] = [];
  const badges = [kindLabel];
  let score = Math.max(0, 25 - sourceRank);

  if (kind === "specialist") {
    score += 6;
    flags.push("specialist_type");
  } else if (kind === "clinic") {
    score += 4.5;
    flags.push("clinic_type");
  } else if (kind === "hospital") {
    score += 3.5;
    flags.push("hospital_type");
  } else if (kind === "laboratory") {
    score -= 1.5;
  } else if (kind === "pharmacy") {
    score -= 3.5;
  }

  if (specialty) {
    const specialtyAliases = [
      normalizeText(specialty.display_name),
      ...((specialty.search_aliases ?? []).map(normalizeText)),
    ];
    const specialtyMatches = countAliasMatches(bag, specialtyAliases);
    if (specialtyMatches > 0) {
      score += 5 + Math.min(2, specialtyMatches - 1);
      flags.push("specialty_match");
      badges.push(specialty.display_name);
    }
  }

  if (city) {
    const cityAliases = [
      normalizeText(city.name),
      ...((city.search_aliases ?? []).map(normalizeText)),
    ];
    if (countAliasMatches(bag, cityAliases) > 0) {
      score += 2;
      flags.push("city_match");
      badges.push(city.name);
    }
  }

  if (queryNormalized) {
    const queryTokens = queryNormalized.split(" ").filter((token) => token.length >= 4);
    const tokenMatches = queryTokens.filter((token) => hasWholePhrase(bag, token)).length;
    if (tokenMatches > 0) {
      score += Math.min(3, tokenMatches * 0.8);
      flags.push("query_token_match");
    }
  }

  if (typeof place.rating === "number") {
    score += Math.min(2, place.rating * 0.25);
    flags.push("good_rating");
  }

  if (typeof place.user_rating_count === "number" && place.user_rating_count > 0) {
    score += Math.min(1.5, Math.log10(place.user_rating_count + 1));
  }

  if (isFavorite) {
    score += 1.25;
    flags.push("favorite");
    badges.unshift("Favorito");
  }

  return {
    score: Number(score.toFixed(2)),
    flags,
    kind,
    kindLabel,
    badges: Array.from(new Set(badges)).slice(0, 3),
  };
}

async function loadFavoritePlaceIds(userId: string, placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();

  const { data, error } = await adminSupabase
    .from("medical_directory_favorites")
    .select("place_id")
    .eq("user_id", userId)
    .in("place_id", placeIds);

  if (error) {
    if (isMissingFavoritesTableError(error)) return new Set();
    throw error;
  }
  return new Set((data ?? []).map((row) => row.place_id as string));
}

function decoratePlacesForResponse(params: {
  places: DirectoryPlaceRow[];
  queryNormalized: string;
  city: CityRow | null;
  specialty: SpecialtyRow | null;
  favoriteIds: Set<string>;
}): DirectoryPlaceRow[] {
  return params.places
    .map((place, index) => {
      const sourceRank = place.source_rank ?? index + 1;
      const isFavorite = params.favoriteIds.has(place.id);
      const score = computeLocalScore({
        place,
        queryNormalized: params.queryNormalized,
        city: params.city,
        specialty: params.specialty,
        sourceRank,
        isFavorite,
      });

      return {
        ...place,
        source_rank: sourceRank,
        local_score: score.score,
        match_flags: score.flags,
        place_kind: score.kind,
        place_kind_label: score.kindLabel,
        badge_labels: score.badges,
        is_favorite: isFavorite,
      };
    })
    .sort((a, b) => {
      if ((b.local_score ?? 0) !== (a.local_score ?? 0)) {
        return (b.local_score ?? 0) - (a.local_score ?? 0);
      }
      return (a.source_rank ?? 999) - (b.source_rank ?? 999);
    });
}

async function getCachedPlaces(cacheId: string): Promise<DirectoryPlaceRow[]> {
  const { data: resultRows, error: resultError } = await adminSupabase
    .from("medical_directory_search_cache_results")
    .select("place_id, result_rank, source_rank")
    .eq("cache_id", cacheId)
    .order("result_rank", { ascending: true });

  if (resultError) throw resultError;
  const rows = (resultRows ?? []) as SearchCacheResultRow[];
  if (rows.length === 0) return [];

  const placeIds = rows.map((row) => row.place_id);
  const { data: places, error: placesError } = await adminSupabase
    .from("medical_directory_places")
    .select(`
      id,
      google_place_id,
      display_name,
      formatted_address,
      national_phone,
      latitude,
      longitude,
      primary_type,
      types,
      rating,
      user_rating_count,
      google_maps_uri,
      business_status,
      city_slug
    `)
    .in("id", placeIds);

  if (placesError) throw placesError;

  const byId = new Map<string, DirectoryPlaceRow>();
  for (const place of (places ?? []) as DirectoryPlaceRow[]) {
    byId.set(place.id, place);
  }

  return rows
    .map((row) => {
      const place = byId.get(row.place_id);
      if (!place) return null;
      return {
        ...place,
        source_rank: row.source_rank ?? row.result_rank,
      };
    })
    .filter((place): place is DirectoryPlaceRow => Boolean(place));
}

async function recordSearchEvent(input: {
  userId: string;
  cacheKey: string;
  queryRaw: string;
  queryNormalized: string;
  citySlug: string | null;
  specialtySlug: string | null;
  searchMode: SearchMode;
  page: number;
  cacheStatus: CacheStatus;
  googleCalled: boolean;
  resultCount: number;
  latencyMs: number;
}) {
  try {
    await adminSupabase.from("medical_directory_search_events").insert({
      user_id: input.userId,
      cache_key: input.cacheKey,
      query_raw: input.queryRaw,
      query_normalized: input.queryNormalized,
      city_slug: input.citySlug,
      specialty_slug: input.specialtySlug,
      search_mode: input.searchMode,
      page: input.page,
      cache_status: input.cacheStatus,
      google_called: input.googleCalled,
      result_count: input.resultCount,
      latency_ms: input.latencyMs,
    });
  } catch (error) {
    console.error("No se pudo registrar medical_directory_search_event:", error);
  }
}

async function markCacheServed(cacheRow: SearchCacheRow) {
  try {
    await adminSupabase
      .from("medical_directory_search_cache")
      .update({
        hit_count: (cacheRow.hit_count ?? 0) + 1,
      } as { hit_count: number })
      .eq("id", cacheRow.id);
  } catch (error) {
    console.error("No se pudo incrementar hit_count del cache:", error);
  }
}

async function callGooglePlaces(params: {
  query: string;
  pageSize: number;
  pageToken: string | null;
  searchMode: SearchMode;
  city: CityRow | null;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  includeRichFields: boolean;
}) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Falta GOOGLE_MAPS_API_KEY en los secrets de Supabase");
  }

  const body: Record<string, unknown> = {
    textQuery: params.query,
    pageSize: params.pageSize,
    languageCode: "es",
    regionCode: "CO",
  };

  if (params.searchMode === "nearby") {
    body.rankPreference = "DISTANCE";
  }

  const locationBias = buildLocationBias(
    params.searchMode,
    params.city,
    params.latitude,
    params.longitude,
    params.radiusMeters
  );
  if (locationBias) {
    body.locationBias = locationBias;
  }

  if (params.pageToken) {
    body.pageToken = params.pageToken;
  }

  const response = await fetch(GOOGLE_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": getFieldMask(params.includeRichFields),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Places error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { places?: GooglePlace[]; nextPageToken?: string };
  return {
    places: data.places ?? [],
    nextPageToken: data.nextPageToken ?? null,
  };
}

async function syncPlacesAndCache(params: {
  cacheId: string;
  refreshToken: string;
  googlePlaces: GooglePlace[];
  nextPageToken: string | null;
  searchMode: SearchMode;
  city: CityRow | null;
  specialty: SpecialtyRow | null;
}) {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getCacheTtlHours(params.searchMode, params.googlePlaces.length) * 60 * 60 * 1000).toISOString();

  const placeRows = params.googlePlaces.map((place) => ({
    google_place_id: place.id,
    display_name: place.displayName?.text?.trim() || "Lugar medico",
    formatted_address: place.formattedAddress ?? null,
    national_phone: place.nationalPhoneNumber ?? null,
    latitude: isFiniteNumber(place.location?.latitude) ? place.location!.latitude : null,
    longitude: isFiniteNumber(place.location?.longitude) ? place.location!.longitude : null,
    primary_type: place.primaryType ?? null,
    types: place.types ?? [],
    rating: isFiniteNumber(place.rating) ? Number(place.rating.toFixed(2)) : null,
    user_rating_count: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    google_maps_uri: place.googleMapsUri ?? null,
    business_status: place.businessStatus ?? null,
    city_slug: params.city?.slug ?? null,
    source: "google_places",
    metadata: {
      last_search_mode: params.searchMode,
      last_city_slug: params.city?.slug ?? null,
      last_specialty_slug: params.specialty?.slug ?? null,
    },
    last_google_sync_at: nowIso,
    expires_at: expiresAt,
  }));

  let placeIdByGoogleId = new Map<string, string>();

  if (placeRows.length > 0) {
    const { data: upsertedPlaces, error: placeError } = await adminSupabase
      .from("medical_directory_places")
      .upsert(placeRows, { onConflict: "google_place_id" })
      .select("id, google_place_id");

    if (placeError) throw placeError;

    for (const row of upsertedPlaces ?? []) {
      placeIdByGoogleId.set(row.google_place_id as string, row.id as string);
    }
  }

  if (params.specialty && placeIdByGoogleId.size > 0) {
    await adminSupabase
      .from("medical_directory_place_specialties")
      .upsert(
        Array.from(placeIdByGoogleId.values()).map((placeId) => ({
          place_id: placeId,
          specialty_id: params.specialty!.id,
          source: "query_inference",
          confidence: 0.65,
          is_primary: true,
        })),
        { onConflict: "place_id,specialty_id,source" }
      );
  }

  await adminSupabase
    .from("medical_directory_search_cache_results")
    .delete()
    .eq("cache_id", params.cacheId);

  if (placeIdByGoogleId.size > 0) {
    const cacheResultsRows = params.googlePlaces
      .map((place, index) => {
        const placeId = placeIdByGoogleId.get(place.id);
        if (!placeId) return null;
        return {
          cache_id: params.cacheId,
          place_id: placeId,
          result_rank: index + 1,
          source_rank: index + 1,
        };
      })
      .filter((row): row is {
        cache_id: string;
        place_id: string;
        result_rank: number;
        source_rank: number;
      } => Boolean(row));

    if (cacheResultsRows.length > 0) {
      const { error: cacheResultsError } = await adminSupabase
        .from("medical_directory_search_cache_results")
        .insert(cacheResultsRows);
      if (cacheResultsError) throw cacheResultsError;
    }
  }

  const { error: cacheUpdateError } = await adminSupabase
    .from("medical_directory_search_cache")
    .update({
      status: "ready",
      result_count: params.googlePlaces.length,
      google_next_page_token: params.nextPageToken,
      google_called_count: 1,
      last_google_sync_at: nowIso,
      expires_at: expiresAt,
      refresh_started_at: null,
      refresh_token: null,
      last_error: null,
    })
    .eq("id", params.cacheId)
    .eq("refresh_token", params.refreshToken);

  if (cacheUpdateError) throw cacheUpdateError;
}

async function markCacheFailed(cacheId: string, refreshToken: string, errorMessage: string) {
  await adminSupabase
    .from("medical_directory_search_cache")
    .update({
      status: "failed",
      refresh_started_at: null,
      refresh_token: null,
      last_error: errorMessage,
    })
    .eq("id", cacheId)
    .eq("refresh_token", refreshToken);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();

  try {
    const authSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authSupabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Sesion no valida" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as SearchMedicalPlacesRequest;
    const rawQuery = (body.query ?? "").trim();
    const page = Math.max(1, Math.trunc(body.page ?? 1));
    const pageSize = Math.min(Math.max(Math.trunc(body.pageSize ?? 20), 1), 20);
    const includeRichFields = body.includeRichFields === true;
    const forceRefresh = body.forceRefresh === true;
    const queryNormalized = normalizeText(rawQuery);

    const { cities, specialties } = await loadLookups();
    const city = findCity(queryNormalized, body.citySlug, cities);
    const specialty = findSpecialty(queryNormalized, body.specialtySlug, specialties);
    const searchMode = inferSearchMode(queryNormalized, city, body.latitude, body.longitude);

    if (!rawQuery && !specialty && !city && !(isFiniteNumber(body.latitude) && isFiniteNumber(body.longitude))) {
      return new Response(JSON.stringify({ error: "Debes enviar una consulta, especialidad, ciudad o coordenadas" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (page > 1 && !body.pageToken) {
      return new Response(JSON.stringify({ error: "Para pedir pagina > 1 debes enviar pageToken" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const googleQuery = buildGoogleTextQuery(rawQuery, searchMode, city, specialty);
    const cacheKey = buildCacheKey({
      normalizedQuery: queryNormalized || normalizeText(googleQuery),
      searchMode,
      city,
      specialty,
      latitude: body.latitude,
      longitude: body.longitude,
      radiusMeters: body.radiusMeters,
      page,
      includeRichFields,
    });

    const { data: cacheRowData, error: cacheRowError } = await adminSupabase
      .from("medical_directory_search_cache")
      .select("id, status, expires_at, google_next_page_token, result_count, refresh_token, hit_count")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheRowError) throw cacheRowError;

    const cacheRow = cacheRowData as SearchCacheRow | null;
    const cachedPlaces = cacheRow ? await getCachedPlaces(cacheRow.id) : [];
    const favoriteIds = await loadFavoritePlaceIds(
      authData.user.id,
      cachedPlaces.map((place) => place.id)
    );
    const decoratedCachedPlaces = decoratePlacesForResponse({
      places: cachedPlaces,
      queryNormalized: queryNormalized || normalizeText(googleQuery),
      city,
      specialty,
      favoriteIds,
    });
    const isFresh = Boolean(
      cacheRow?.expires_at && new Date(cacheRow.expires_at).getTime() > Date.now()
    );

    if (cacheRow && decoratedCachedPlaces.length > 0 && isFresh && !forceRefresh) {
      await markCacheServed(cacheRow);

      const response: SearchResponse = {
        results: decoratedCachedPlaces,
        meta: {
          cacheStatus: "hit",
          googleCalled: false,
          stale: false,
          shouldRefresh: false,
          normalizedQuery: queryNormalized || normalizeText(googleQuery),
          searchMode,
          page,
          pageSize,
          city: city ? { slug: city.slug, name: city.name } : null,
          specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
          nextPageToken: cacheRow.google_next_page_token,
        },
      };

      await recordSearchEvent({
        userId: authData.user.id,
        cacheKey,
        queryRaw: rawQuery || googleQuery,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        citySlug: city?.slug ?? null,
        specialtySlug: specialty?.slug ?? null,
        searchMode,
        page,
        cacheStatus: "hit",
        googleCalled: false,
        resultCount: decoratedCachedPlaces.length,
        latencyMs: Date.now() - startedAt,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (cacheRow && decoratedCachedPlaces.length > 0 && !forceRefresh) {
      await markCacheServed(cacheRow);

      const response: SearchResponse = {
        results: decoratedCachedPlaces,
        meta: {
          cacheStatus: "stale",
          googleCalled: false,
          stale: true,
          shouldRefresh: true,
          normalizedQuery: queryNormalized || normalizeText(googleQuery),
          searchMode,
          page,
          pageSize,
          city: city ? { slug: city.slug, name: city.name } : null,
          specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
          nextPageToken: cacheRow.google_next_page_token,
          warning: "Resultados servidos desde cache vencido; puedes refrescar en segundo plano.",
        },
      };

      await recordSearchEvent({
        userId: authData.user.id,
        cacheKey,
        queryRaw: rawQuery || googleQuery,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        citySlug: city?.slug ?? null,
        specialtySlug: specialty?.slug ?? null,
        searchMode,
        page,
        cacheStatus: "stale",
        googleCalled: false,
        resultCount: decoratedCachedPlaces.length,
        latencyMs: Date.now() - startedAt,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: claimData, error: claimError } = await adminSupabase.rpc(
      "claim_medical_directory_cache_refresh",
      {
        p_cache_key: cacheKey,
        p_query_raw_example: rawQuery || googleQuery,
        p_query_normalized: queryNormalized || normalizeText(googleQuery),
        p_city_slug: city?.slug ?? null,
        p_specialty_slug: specialty?.slug ?? null,
        p_search_mode: searchMode,
        p_page: page,
        p_page_size: pageSize,
        p_page_token_seed: body.pageToken ?? null,
        p_filters: {
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          radius_meters: body.radiusMeters ?? null,
          include_rich_fields: includeRichFields,
        },
        p_lock_ttl_seconds: LOCK_TTL_SECONDS,
      }
    );

    if (claimError) throw claimError;

    const claim = Array.isArray(claimData) ? (claimData[0] as ClaimRefreshRow | undefined) : undefined;
    if (!claim) {
      throw new Error("No se pudo reclamar el refresh del cache");
    }

    if (!claim.acquired) {
      await sleep(POLL_WAIT_MS);
      const { data: polledCacheData } = await adminSupabase
        .from("medical_directory_search_cache")
        .select("id, status, expires_at, google_next_page_token, result_count, refresh_token")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      const polledCache = polledCacheData as SearchCacheRow | null;
      const polledPlaces = polledCache ? await getCachedPlaces(polledCache.id) : [];
      const polledFavoriteIds = await loadFavoritePlaceIds(
        authData.user.id,
        polledPlaces.map((place) => place.id)
      );
      const decoratedPolledPlaces = decoratePlacesForResponse({
        places: polledPlaces,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        city,
        specialty,
        favoriteIds: polledFavoriteIds,
      });

      if (polledCache && decoratedPolledPlaces.length > 0) {
        const response: SearchResponse = {
          results: decoratedPolledPlaces,
          meta: {
            cacheStatus: "hit",
            googleCalled: false,
            stale: false,
            shouldRefresh: false,
            normalizedQuery: queryNormalized || normalizeText(googleQuery),
            searchMode,
            page,
            pageSize,
            city: city ? { slug: city.slug, name: city.name } : null,
            specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
            nextPageToken: polledCache.google_next_page_token,
          },
        };

        await recordSearchEvent({
          userId: authData.user.id,
          cacheKey,
          queryRaw: rawQuery || googleQuery,
          queryNormalized: queryNormalized || normalizeText(googleQuery),
          citySlug: city?.slug ?? null,
          specialtySlug: specialty?.slug ?? null,
          searchMode,
          page,
          cacheStatus: "hit",
          googleCalled: false,
          resultCount: decoratedPolledPlaces.length,
          latencyMs: Date.now() - startedAt,
        });

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const response: SearchResponse = {
        results: [],
        meta: {
          cacheStatus: "processing",
          googleCalled: false,
          stale: false,
          shouldRefresh: true,
          normalizedQuery: queryNormalized || normalizeText(googleQuery),
          searchMode,
          page,
          pageSize,
          city: city ? { slug: city.slug, name: city.name } : null,
          specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
          nextPageToken: null,
          retryAfterMs: POLL_WAIT_MS,
          warning: "Otra solicitud esta refrescando este cache; reintenta en un momento.",
        },
      };

      await recordSearchEvent({
        userId: authData.user.id,
        cacheKey,
        queryRaw: rawQuery || googleQuery,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        citySlug: city?.slug ?? null,
        specialtySlug: specialty?.slug ?? null,
        searchMode,
        page,
        cacheStatus: "processing",
        googleCalled: false,
        resultCount: 0,
        latencyMs: Date.now() - startedAt,
      });

      return new Response(JSON.stringify(response), {
        status: 202,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      const googleData = await callGooglePlaces({
        query: googleQuery,
        pageSize,
        pageToken: body.pageToken ?? null,
        searchMode,
        city,
        latitude: body.latitude,
        longitude: body.longitude,
        radiusMeters: body.radiusMeters,
        includeRichFields,
      });

      await syncPlacesAndCache({
        cacheId: claim.cache_id,
        refreshToken: claim.refresh_token,
        googlePlaces: googleData.places,
        nextPageToken: googleData.nextPageToken,
        searchMode,
        city,
        specialty,
      });

      const refreshedPlaces = await getCachedPlaces(claim.cache_id);
      const refreshedFavoriteIds = await loadFavoritePlaceIds(
        authData.user.id,
        refreshedPlaces.map((place) => place.id)
      );
      const decoratedRefreshedPlaces = decoratePlacesForResponse({
        places: refreshedPlaces,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        city,
        specialty,
        favoriteIds: refreshedFavoriteIds,
      });
      const response: SearchResponse = {
        results: decoratedRefreshedPlaces,
        meta: {
          cacheStatus: "refreshed",
          googleCalled: true,
          stale: false,
          shouldRefresh: false,
          normalizedQuery: queryNormalized || normalizeText(googleQuery),
          searchMode,
          page,
          pageSize,
          city: city ? { slug: city.slug, name: city.name } : null,
          specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
          nextPageToken: googleData.nextPageToken,
        },
      };

      await recordSearchEvent({
        userId: authData.user.id,
        cacheKey,
        queryRaw: rawQuery || googleQuery,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        citySlug: city?.slug ?? null,
        specialtySlug: specialty?.slug ?? null,
        searchMode,
        page,
        cacheStatus: "refreshed",
        googleCalled: true,
        resultCount: decoratedRefreshedPlaces.length,
        latencyMs: Date.now() - startedAt,
      });

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno";
      await markCacheFailed(claim.cache_id, claim.refresh_token, message);

      if (decoratedCachedPlaces.length > 0) {
        const response: SearchResponse = {
          results: decoratedCachedPlaces,
          meta: {
            cacheStatus: "stale",
            googleCalled: true,
            stale: true,
            shouldRefresh: true,
            normalizedQuery: queryNormalized || normalizeText(googleQuery),
            searchMode,
            page,
            pageSize,
            city: city ? { slug: city.slug, name: city.name } : null,
            specialty: specialty ? { slug: specialty.slug, displayName: specialty.display_name } : null,
            nextPageToken: cacheRow?.google_next_page_token ?? null,
            warning: `Google Places fallo; se devolvio cache previo. ${message}`,
          },
        };

        await recordSearchEvent({
          userId: authData.user.id,
          cacheKey,
          queryRaw: rawQuery || googleQuery,
          queryNormalized: queryNormalized || normalizeText(googleQuery),
          citySlug: city?.slug ?? null,
          specialtySlug: specialty?.slug ?? null,
          searchMode,
          page,
          cacheStatus: "stale",
          googleCalled: true,
          resultCount: decoratedCachedPlaces.length,
          latencyMs: Date.now() - startedAt,
        });

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      await recordSearchEvent({
        userId: authData.user.id,
        cacheKey,
        queryRaw: rawQuery || googleQuery,
        queryNormalized: queryNormalized || normalizeText(googleQuery),
        citySlug: city?.slug ?? null,
        specialtySlug: specialty?.slug ?? null,
        searchMode,
        page,
        cacheStatus: "error",
        googleCalled: true,
        resultCount: 0,
        latencyMs: Date.now() - startedAt,
      });

      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("search-medical-places error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Error interno",
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
