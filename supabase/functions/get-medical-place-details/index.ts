// ============================================================
// Edge Function: get-medical-place-details
// Place Details on-demand con cache separado para bajar costo
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_PLACE_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DetailsRequest {
  placeId?: string;
  forceRefresh?: boolean;
}

interface DirectoryPlaceDetailsRow {
  id: string;
  google_place_id: string;
  display_name: string;
  formatted_address: string | null;
  national_phone: string | null;
  international_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  primary_type: string | null;
  types: string[] | null;
  rating: number | null;
  user_rating_count: number | null;
  google_maps_uri: string | null;
  business_status: string | null;
  city_slug: string | null;
  website_uri: string | null;
  current_opening_hours: unknown;
  regular_opening_hours: unknown;
  last_google_sync_at: string | null;
  expires_at: string | null;
  detail_last_google_sync_at: string | null;
  detail_expires_at: string | null;
  is_favorite?: boolean;
  place_kind?: "specialist" | "clinic" | "hospital" | "laboratory" | "pharmacy" | "health_service";
  place_kind_label?: string;
  badge_labels?: string[];
}

interface GooglePlaceDetails {
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
  internationalPhoneNumber?: string;
  websiteUri?: string;
  currentOpeningHours?: unknown;
  regularOpeningHours?: unknown;
}

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isMissingFavoritesTableError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return error?.code === "PGRST205" && haystack.includes("medical_directory_favorites");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlaceKind(place: Pick<DirectoryPlaceDetailsRow, "display_name" | "primary_type" | "types">) {
  const types = new Set((place.types ?? []).map((type) => normalizeText(type)));
  const primaryType = normalizeText(place.primary_type ?? "");
  const name = normalizeText(place.display_name);

  if (types.has("hospital") || primaryType === "hospital" || name.includes("hospital")) {
    return { kind: "hospital" as const, label: "Hospital" };
  }
  if (
    types.has("medical_clinic")
    || primaryType === "medical_clinic"
    || name.includes("clinica")
    || name.includes("clínica")
    || name.includes("consultorio")
  ) {
    return {
      kind: name.includes("consultorio") ? "clinic" as const : "clinic" as const,
      label: name.includes("consultorio") ? "Consultorio" : "Clínica",
    };
  }
  if (
    types.has("doctor")
    || primaryType === "doctor"
    || name.includes("medico")
    || name.includes("médico")
    || name.includes("dr ")
    || name.includes("dra ")
  ) {
    return { kind: "specialist" as const, label: "Especialista" };
  }
  if (types.has("medical_lab") || primaryType === "medical_lab" || name.includes("laboratorio")) {
    return { kind: "laboratory" as const, label: "Laboratorio" };
  }
  if (types.has("pharmacy") || primaryType === "pharmacy" || name.includes("farmacia") || name.includes("drogueria")) {
    return { kind: "pharmacy" as const, label: "Farmacia" };
  }
  return { kind: "health_service" as const, label: "Servicio de salud" };
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

function decoratePlace(place: DirectoryPlaceDetailsRow, favoriteIds: Set<string>): DirectoryPlaceDetailsRow {
  const { kind, label } = getPlaceKind(place);
  return {
    ...place,
    is_favorite: favoriteIds.has(place.id),
    place_kind: kind,
    place_kind_label: label,
    badge_labels: favoriteIds.has(place.id) ? ["Favorito", label] : [label],
  };
}

function getFieldMask(): string {
  return [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "primaryType",
    "types",
    "googleMapsUri",
    "businessStatus",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "rating",
    "userRatingCount",
    "websiteUri",
    "currentOpeningHours",
    "regularOpeningHours",
  ].join(",");
}

function hasFreshDetails(place: DirectoryPlaceDetailsRow, forceRefresh: boolean) {
  if (forceRefresh) return false;
  if (!place.detail_expires_at || !place.detail_last_google_sync_at) return false;
  return new Date(place.detail_expires_at).getTime() > Date.now();
}

async function fetchPlace(placeId: string): Promise<DirectoryPlaceDetailsRow | null> {
  const { data, error } = await adminSupabase
    .from("medical_directory_places")
    .select(`
      id,
      google_place_id,
      display_name,
      formatted_address,
      national_phone,
      international_phone,
      latitude,
      longitude,
      primary_type,
      types,
      rating,
      user_rating_count,
      google_maps_uri,
      business_status,
      city_slug,
      website_uri,
      current_opening_hours,
      regular_opening_hours,
      last_google_sync_at,
      expires_at,
      detail_last_google_sync_at,
      detail_expires_at
    `)
    .eq("id", placeId)
    .maybeSingle();

  if (error) throw error;
  return (data as DirectoryPlaceDetailsRow | null) ?? null;
}

async function callGooglePlaceDetails(googlePlaceId: string): Promise<GooglePlaceDetails> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Falta GOOGLE_MAPS_API_KEY en los secrets de Supabase");
  }

  const response = await fetch(`${GOOGLE_PLACE_DETAILS_BASE_URL}/${encodeURIComponent(googlePlaceId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": getFieldMask(),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Place Details error ${response.status}: ${errorText}`);
  }

  return await response.json() as GooglePlaceDetails;
}

async function syncPlaceDetails(place: DirectoryPlaceDetailsRow, google: GooglePlaceDetails) {
  const nowIso = new Date().toISOString();
  const detailExpiresAt = new Date(Date.now() + DETAIL_TTL_MS).toISOString();

  const { data, error } = await adminSupabase
    .from("medical_directory_places")
    .update({
      display_name: google.displayName?.text?.trim() || place.display_name,
      formatted_address: google.formattedAddress ?? place.formatted_address,
      national_phone: google.nationalPhoneNumber ?? place.national_phone,
      international_phone: google.internationalPhoneNumber ?? place.international_phone,
      latitude: isFiniteNumber(google.location?.latitude) ? google.location!.latitude : place.latitude,
      longitude: isFiniteNumber(google.location?.longitude) ? google.location!.longitude : place.longitude,
      primary_type: google.primaryType ?? place.primary_type,
      types: google.types ?? place.types ?? [],
      rating: isFiniteNumber(google.rating) ? Number(google.rating.toFixed(2)) : place.rating,
      user_rating_count: typeof google.userRatingCount === "number" ? google.userRatingCount : place.user_rating_count,
      google_maps_uri: google.googleMapsUri ?? place.google_maps_uri,
      business_status: google.businessStatus ?? place.business_status,
      website_uri: google.websiteUri ?? place.website_uri,
      current_opening_hours: google.currentOpeningHours ?? place.current_opening_hours,
      regular_opening_hours: google.regularOpeningHours ?? place.regular_opening_hours,
      detail_last_google_sync_at: nowIso,
      detail_expires_at: detailExpiresAt,
      last_google_sync_at: place.last_google_sync_at ?? nowIso,
    })
    .eq("id", place.id)
    .select(`
      id,
      google_place_id,
      display_name,
      formatted_address,
      national_phone,
      international_phone,
      latitude,
      longitude,
      primary_type,
      types,
      rating,
      user_rating_count,
      google_maps_uri,
      business_status,
      city_slug,
      website_uri,
      current_opening_hours,
      regular_opening_hours,
      last_google_sync_at,
      expires_at,
      detail_last_google_sync_at,
      detail_expires_at
    `)
    .single();

  if (error) throw error;
  return data as DirectoryPlaceDetailsRow;
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

    const { placeId, forceRefresh = false } = await req.json() as DetailsRequest;
    if (!placeId?.trim()) {
      return new Response(JSON.stringify({ error: "placeId es requerido" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const place = await fetchPlace(placeId.trim());
    if (!place) {
      return new Response(JSON.stringify({ error: "Lugar no encontrado" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (hasFreshDetails(place, forceRefresh)) {
      const favoriteIds = await loadFavoritePlaceIds(authData.user.id, [place.id]);
      return new Response(JSON.stringify({
        place: decoratePlace(place, favoriteIds),
        meta: {
          cacheStatus: "hit",
          googleCalled: false,
          stale: false,
          warning: null,
        },
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      const google = await callGooglePlaceDetails(place.google_place_id);
      const refreshedPlace = await syncPlaceDetails(place, google);
      const favoriteIds = await loadFavoritePlaceIds(authData.user.id, [refreshedPlace.id]);

      return new Response(JSON.stringify({
        place: decoratePlace(refreshedPlace, favoriteIds),
        meta: {
          cacheStatus: "refreshed",
          googleCalled: true,
          stale: false,
          warning: null,
        },
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno";

      const favoriteIds = await loadFavoritePlaceIds(authData.user.id, [place.id]);
      return new Response(JSON.stringify({
        place: decoratePlace(place, favoriteIds),
        meta: {
          cacheStatus: "stale",
          googleCalled: true,
          stale: true,
          warning: `No se pudo refrescar el detalle con Google Places. ${message}`,
        },
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("get-medical-place-details error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Error interno",
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
