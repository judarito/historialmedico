import { supabase } from "./supabase";
import { captureException } from "./runtimeDiagnostics";

function isMissingFavoritesTableError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  const haystack = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return error?.code === "PGRST205"
    && haystack.includes("medical_directory_favorites");
}

export interface MedicalDirectorySearchParams {
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

export interface MedicalDirectoryPlace {
  id: string;
  google_place_id: string;
  display_name: string;
  formatted_address: string | null;
  national_phone: string | null;
  international_phone?: string | null;
  latitude: number | null;
  longitude: number | null;
  primary_type: string | null;
  types: string[] | null;
  rating: number | null;
  user_rating_count: number | null;
  google_maps_uri: string | null;
  business_status: string | null;
  city_slug: string | null;
  website_uri?: string | null;
  current_opening_hours?: unknown;
  regular_opening_hours?: unknown;
  detail_last_google_sync_at?: string | null;
  detail_expires_at?: string | null;
  source_rank?: number | null;
  local_score?: number;
  match_flags?: string[];
  place_kind?: "specialist" | "clinic" | "hospital" | "laboratory" | "pharmacy" | "health_service";
  place_kind_label?: string;
  badge_labels?: string[];
  is_favorite?: boolean;
}

export interface MedicalDirectorySearchResponse {
  results: MedicalDirectoryPlace[];
  meta: {
    cacheStatus: "hit" | "stale" | "refreshed" | "processing" | "error";
    googleCalled: boolean;
    stale: boolean;
    shouldRefresh: boolean;
    normalizedQuery: string;
    searchMode: "city" | "nearby" | "text";
    page: number;
    pageSize: number;
    city: { slug: string; name: string } | null;
    specialty: { slug: string; displayName: string } | null;
    nextPageToken: string | null;
    retryAfterMs?: number;
    warning?: string;
  };
}

export interface MedicalDirectoryDetailsResponse {
  place: MedicalDirectoryPlace;
  meta: {
    cacheStatus: "hit" | "stale" | "refreshed" | "processing" | "error";
    googleCalled: boolean;
    stale: boolean;
    warning?: string | null;
  };
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Usuario no autenticado");
  }
  return data.user.id;
}

const PROCESSING_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MedicalDirectoryService {
  static async search(
    params: MedicalDirectorySearchParams,
    attempt = 0
  ): Promise<MedicalDirectorySearchResponse> {
    const { data, error } = await supabase.functions.invoke("search-medical-places", {
      body: params,
    });

    if (error) {
      await captureException("MedicalDirectoryService.search", error, {
        extra: { params, attempt },
      });
      throw new Error(error.message || "No se pudo buscar especialistas");
    }

    const response = data as MedicalDirectorySearchResponse;
    if (
      response?.meta?.cacheStatus === "processing" &&
      attempt < 1
    ) {
      await sleep(response.meta.retryAfterMs ?? PROCESSING_RETRY_DELAY_MS);
      return this.search(params, attempt + 1);
    }

    return response;
  }

  static async listCities() {
    const { data, error } = await supabase
      .from("medical_directory_cities")
      .select("id, slug, name, department, centroid_lat, centroid_lng")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      await captureException("MedicalDirectoryService.listCities", error);
      throw new Error("No se pudieron cargar las ciudades");
    }

    return data ?? [];
  }

  static async listSpecialties() {
    const { data, error } = await supabase
      .from("medical_directory_specialties")
      .select("id, slug, display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    if (error) {
      await captureException("MedicalDirectoryService.listSpecialties", error);
      throw new Error("No se pudieron cargar las especialidades");
    }

    return data ?? [];
  }

  static async getPlaceDetails(
    placeId: string,
    forceRefresh = false
  ): Promise<MedicalDirectoryDetailsResponse> {
    const { data, error } = await supabase.functions.invoke("get-medical-place-details", {
      body: {
        placeId,
        forceRefresh,
      },
    });

    if (error) {
      await captureException("MedicalDirectoryService.getPlaceDetails", error, {
        extra: { placeId, forceRefresh },
      });
      throw new Error(error.message || "No se pudo cargar el detalle del especialista");
    }

    return data as MedicalDirectoryDetailsResponse;
  }

  static async listFavoriteIds(): Promise<string[]> {
    const userId = await requireUserId();

    const { data, error } = await supabase
      .from("medical_directory_favorites")
      .select("place_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingFavoritesTableError(error)) {
        return [];
      }
      await captureException("MedicalDirectoryService.listFavoriteIds", error);
      throw new Error("No se pudieron cargar los favoritos");
    }

    return (data ?? []).map((row) => row.place_id);
  }

  static async listFavoritePlaces(): Promise<MedicalDirectoryPlace[]> {
    const placeIds = await this.listFavoriteIds();
    if (placeIds.length === 0) return [];

    const { data, error } = await supabase
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
        detail_last_google_sync_at,
        detail_expires_at
      `)
      .in("id", placeIds);

    if (error) {
      await captureException("MedicalDirectoryService.listFavoritePlaces", error);
      throw new Error("No se pudieron cargar los lugares guardados");
    }

    if ((data ?? []).length === 0 && placeIds.length > 0) {
      throw new Error("Tus favoritos existen, pero esta base todavía no permite leer los lugares del directorio. Aplica la migración 035 y vuelve a intentar.");
    }

    const byId = new Map((data ?? []).map((item) => [item.id, item as MedicalDirectoryPlace]));
    return placeIds
      .map((placeId) => byId.get(placeId))
      .filter((place): place is MedicalDirectoryPlace => Boolean(place))
      .map((place) => ({ ...place, is_favorite: true }));
  }

  static async setFavorite(placeId: string, shouldFavorite: boolean): Promise<boolean> {
    const userId = await requireUserId();

    if (shouldFavorite) {
      const { error } = await supabase
        .from("medical_directory_favorites")
        .upsert({
          user_id: userId,
          place_id: placeId,
        }, { onConflict: "user_id,place_id" });

      if (error) {
        if (isMissingFavoritesTableError(error)) {
          throw new Error("Los favoritos del directorio todavía no están habilitados en esta base. Aplica la migración 034 y vuelve a intentar.");
        }
        await captureException("MedicalDirectoryService.setFavorite.insert", error, {
          extra: { placeId },
        });
        throw new Error("No se pudo guardar el favorito");
      }

      return true;
    }

    const { error } = await supabase
      .from("medical_directory_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("place_id", placeId);

    if (error) {
      if (isMissingFavoritesTableError(error)) {
        throw new Error("Los favoritos del directorio todavía no están habilitados en esta base. Aplica la migración 034 y vuelve a intentar.");
      }
      await captureException("MedicalDirectoryService.setFavorite.delete", error, {
        extra: { placeId },
      });
      throw new Error("No se pudo quitar el favorito");
    }

    return false;
  }
}
