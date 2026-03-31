-- ============================================================
-- Family Health Tracker — Directorio médico con cache híbrido
-- Migration: 032_medical_directory_places_cache.sql
-- Google Places como fuente inicial + Supabase/Postgres como cache
-- ============================================================

-- ============================================================
-- TABLAS DE REFERENCIA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medical_directory_cities (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  department     TEXT,
  country_code   TEXT NOT NULL DEFAULT 'CO',
  centroid_lat   NUMERIC(9, 6) NOT NULL,
  centroid_lng   NUMERIC(9, 6) NOT NULL,
  search_aliases TEXT[] NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_directory_specialties (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug           TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  search_aliases TEXT[] NOT NULL DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLAS PRINCIPALES DEL DIRECTORIO / CACHE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.medical_directory_places (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_place_id      TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  formatted_address    TEXT,
  national_phone       TEXT,
  latitude             NUMERIC(10, 7),
  longitude            NUMERIC(10, 7),
  primary_type         TEXT,
  types                TEXT[] NOT NULL DEFAULT '{}',
  rating               NUMERIC(3, 2),
  user_rating_count    INTEGER,
  google_maps_uri      TEXT,
  business_status      TEXT,
  city_slug            TEXT,
  source               TEXT NOT NULL DEFAULT 'google_places',
  metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_google_sync_at  TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_directory_place_specialties (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id      UUID NOT NULL REFERENCES public.medical_directory_places(id) ON DELETE CASCADE,
  specialty_id  UUID NOT NULL REFERENCES public.medical_directory_specialties(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'query_inference',
  confidence    NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(place_id, specialty_id, source)
);

CREATE TABLE IF NOT EXISTS public.medical_directory_search_cache (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_key              TEXT NOT NULL UNIQUE,
  query_raw_example      TEXT,
  query_normalized       TEXT NOT NULL,
  city_slug              TEXT,
  specialty_slug         TEXT,
  search_mode            TEXT NOT NULL DEFAULT 'text' CHECK (search_mode IN ('city', 'nearby', 'text')),
  page                   INTEGER NOT NULL DEFAULT 1 CHECK (page > 0),
  page_size              INTEGER NOT NULL DEFAULT 20 CHECK (page_size BETWEEN 1 AND 20),
  page_token_seed        TEXT,
  filters                JSONB NOT NULL DEFAULT '{}'::JSONB,
  status                 TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('refreshing', 'ready', 'failed')),
  hit_count              INTEGER NOT NULL DEFAULT 0,
  result_count           INTEGER NOT NULL DEFAULT 0,
  google_next_page_token TEXT,
  google_called_count    INTEGER NOT NULL DEFAULT 0,
  last_google_sync_at    TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  refresh_started_at     TIMESTAMPTZ,
  refresh_token          UUID,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_directory_search_cache_results (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cache_id     UUID NOT NULL REFERENCES public.medical_directory_search_cache(id) ON DELETE CASCADE,
  place_id     UUID NOT NULL REFERENCES public.medical_directory_places(id) ON DELETE CASCADE,
  result_rank  INTEGER NOT NULL CHECK (result_rank > 0),
  source_rank  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cache_id, place_id)
);

CREATE TABLE IF NOT EXISTS public.medical_directory_search_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cache_key        TEXT,
  query_raw        TEXT NOT NULL,
  query_normalized TEXT NOT NULL,
  city_slug        TEXT,
  specialty_slug   TEXT,
  search_mode      TEXT NOT NULL DEFAULT 'text',
  page             INTEGER NOT NULL DEFAULT 1,
  cache_status     TEXT NOT NULL DEFAULT 'miss',
  google_called    BOOLEAN NOT NULL DEFAULT FALSE,
  result_count     INTEGER NOT NULL DEFAULT 0,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_medical_directory_cities_name_trgm
  ON public.medical_directory_cities USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medical_directory_specialties_display_name_trgm
  ON public.medical_directory_specialties USING GIN (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medical_directory_places_city_slug
  ON public.medical_directory_places(city_slug);

CREATE INDEX IF NOT EXISTS idx_medical_directory_places_primary_type
  ON public.medical_directory_places(primary_type);

CREATE INDEX IF NOT EXISTS idx_medical_directory_places_last_google_sync_at
  ON public.medical_directory_places(last_google_sync_at DESC);

CREATE INDEX IF NOT EXISTS idx_medical_directory_places_expires_at
  ON public.medical_directory_places(expires_at);

CREATE INDEX IF NOT EXISTS idx_medical_directory_search_cache_lookup
  ON public.medical_directory_search_cache(search_mode, city_slug, specialty_slug, page);

CREATE INDEX IF NOT EXISTS idx_medical_directory_search_cache_expires_at
  ON public.medical_directory_search_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_medical_directory_search_cache_results_cache_rank
  ON public.medical_directory_search_cache_results(cache_id, result_rank);

CREATE INDEX IF NOT EXISTS idx_medical_directory_search_events_created_at
  ON public.medical_directory_search_events(created_at DESC);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================
DROP TRIGGER IF EXISTS trg_medical_directory_cities_updated_at
ON public.medical_directory_cities;
CREATE TRIGGER trg_medical_directory_cities_updated_at
BEFORE UPDATE ON public.medical_directory_cities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_medical_directory_specialties_updated_at
ON public.medical_directory_specialties;
CREATE TRIGGER trg_medical_directory_specialties_updated_at
BEFORE UPDATE ON public.medical_directory_specialties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_medical_directory_places_updated_at
ON public.medical_directory_places;
CREATE TRIGGER trg_medical_directory_places_updated_at
BEFORE UPDATE ON public.medical_directory_places
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_medical_directory_place_specialties_updated_at
ON public.medical_directory_place_specialties;
CREATE TRIGGER trg_medical_directory_place_specialties_updated_at
BEFORE UPDATE ON public.medical_directory_place_specialties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_medical_directory_search_cache_updated_at
ON public.medical_directory_search_cache;
CREATE TRIGGER trg_medical_directory_search_cache_updated_at
BEFORE UPDATE ON public.medical_directory_search_cache
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.medical_directory_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_place_specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_search_cache_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_directory_search_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Authenticated users can read medical directory cities"
  ON public.medical_directory_cities
  FOR SELECT
  TO authenticated
  USING (is_active = TRUE);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Authenticated users can read medical directory specialties"
  ON public.medical_directory_specialties
  FOR SELECT
  TO authenticated
  USING (is_active = TRUE);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON public.medical_directory_cities TO authenticated;
GRANT SELECT ON public.medical_directory_specialties TO authenticated;

-- ============================================================
-- RPC: lock suave para evitar thundering herd en busquedas
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_medical_directory_cache_refresh(
  p_cache_key TEXT,
  p_query_raw_example TEXT,
  p_query_normalized TEXT,
  p_city_slug TEXT DEFAULT NULL,
  p_specialty_slug TEXT DEFAULT NULL,
  p_search_mode TEXT DEFAULT 'text',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20,
  p_page_token_seed TEXT DEFAULT NULL,
  p_filters JSONB DEFAULT '{}'::JSONB,
  p_lock_ttl_seconds INTEGER DEFAULT 90
)
RETURNS TABLE (
  cache_id UUID,
  refresh_token UUID,
  acquired BOOLEAN
) AS $$
DECLARE
  v_claim_token UUID := uuid_generate_v4();
BEGIN
  IF COALESCE(BTRIM(p_cache_key), '') = '' THEN
    RAISE EXCEPTION 'cache_key es requerido';
  END IF;

  RETURN QUERY
  WITH claim AS (
    INSERT INTO public.medical_directory_search_cache (
      cache_key,
      query_raw_example,
      query_normalized,
      city_slug,
      specialty_slug,
      search_mode,
      page,
      page_size,
      page_token_seed,
      filters,
      status,
      refresh_started_at,
      refresh_token,
      last_error
    )
    VALUES (
      p_cache_key,
      p_query_raw_example,
      p_query_normalized,
      p_city_slug,
      p_specialty_slug,
      p_search_mode,
      COALESCE(p_page, 1),
      LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 20),
      p_page_token_seed,
      COALESCE(p_filters, '{}'::JSONB),
      'refreshing',
      NOW(),
      v_claim_token,
      NULL
    )
    ON CONFLICT (cache_key) DO UPDATE
    SET
      query_raw_example = COALESCE(EXCLUDED.query_raw_example, public.medical_directory_search_cache.query_raw_example),
      query_normalized = EXCLUDED.query_normalized,
      city_slug = EXCLUDED.city_slug,
      specialty_slug = EXCLUDED.specialty_slug,
      search_mode = EXCLUDED.search_mode,
      page = EXCLUDED.page,
      page_size = EXCLUDED.page_size,
      page_token_seed = COALESCE(EXCLUDED.page_token_seed, public.medical_directory_search_cache.page_token_seed),
      filters = EXCLUDED.filters,
      refresh_token = CASE
        WHEN public.medical_directory_search_cache.refresh_started_at IS NULL
          OR public.medical_directory_search_cache.refresh_started_at < NOW() - make_interval(secs => GREATEST(COALESCE(p_lock_ttl_seconds, 90), 30))
          OR public.medical_directory_search_cache.status <> 'refreshing'
        THEN EXCLUDED.refresh_token
        ELSE public.medical_directory_search_cache.refresh_token
      END,
      refresh_started_at = CASE
        WHEN public.medical_directory_search_cache.refresh_started_at IS NULL
          OR public.medical_directory_search_cache.refresh_started_at < NOW() - make_interval(secs => GREATEST(COALESCE(p_lock_ttl_seconds, 90), 30))
          OR public.medical_directory_search_cache.status <> 'refreshing'
        THEN NOW()
        ELSE public.medical_directory_search_cache.refresh_started_at
      END,
      status = CASE
        WHEN public.medical_directory_search_cache.refresh_started_at IS NULL
          OR public.medical_directory_search_cache.refresh_started_at < NOW() - make_interval(secs => GREATEST(COALESCE(p_lock_ttl_seconds, 90), 30))
          OR public.medical_directory_search_cache.status <> 'refreshing'
        THEN 'refreshing'
        ELSE public.medical_directory_search_cache.status
      END,
      last_error = CASE
        WHEN public.medical_directory_search_cache.refresh_started_at IS NULL
          OR public.medical_directory_search_cache.refresh_started_at < NOW() - make_interval(secs => GREATEST(COALESCE(p_lock_ttl_seconds, 90), 30))
          OR public.medical_directory_search_cache.status <> 'refreshing'
        THEN NULL
        ELSE public.medical_directory_search_cache.last_error
      END,
      updated_at = NOW()
    RETURNING
      public.medical_directory_search_cache.id,
      public.medical_directory_search_cache.refresh_token
  )
  SELECT
    claim.id,
    claim.refresh_token,
    claim.refresh_token = v_claim_token
  FROM claim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.claim_medical_directory_cache_refresh(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, JSONB, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_medical_directory_cache_refresh(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, JSONB, INTEGER
) TO service_role;

-- ============================================================
-- SEMILLAS: ciudades colombianas clave
-- ============================================================
INSERT INTO public.medical_directory_cities (
  slug, name, department, country_code, centroid_lat, centroid_lng, search_aliases
) VALUES
  ('bogota', 'Bogotá', 'Bogotá D.C.', 'CO', 4.711000, -74.072100, ARRAY['bogota', 'bogotá', 'bogota dc', 'bogota d c']),
  ('medellin', 'Medellín', 'Antioquia', 'CO', 6.244200, -75.581200, ARRAY['medellin', 'medellín']),
  ('cali', 'Cali', 'Valle del Cauca', 'CO', 3.451600, -76.532000, ARRAY['cali', 'santiago de cali']),
  ('barranquilla', 'Barranquilla', 'Atlántico', 'CO', 10.968500, -74.781300, ARRAY['barranquilla']),
  ('cartagena', 'Cartagena', 'Bolívar', 'CO', 10.391000, -75.479400, ARRAY['cartagena', 'cartagena de indias']),
  ('bucaramanga', 'Bucaramanga', 'Santander', 'CO', 7.119300, -73.122700, ARRAY['bucaramanga']),
  ('santa-marta', 'Santa Marta', 'Magdalena', 'CO', 11.240800, -74.199000, ARRAY['santa marta', 'santa-marta']),
  ('pereira', 'Pereira', 'Risaralda', 'CO', 4.814300, -75.694600, ARRAY['pereira']),
  ('manizales', 'Manizales', 'Caldas', 'CO', 5.070300, -75.513800, ARRAY['manizales']),
  ('cucuta', 'Cúcuta', 'Norte de Santander', 'CO', 7.893900, -72.507800, ARRAY['cucuta', 'cúcuta', 'san jose de cucuta', 'san josé de cúcuta']),
  ('villavicencio', 'Villavicencio', 'Meta', 'CO', 4.142000, -73.626600, ARRAY['villavicencio']),
  ('ibague', 'Ibagué', 'Tolima', 'CO', 4.438900, -75.232200, ARRAY['ibague', 'ibagué']),
  ('pasto', 'Pasto', 'Nariño', 'CO', 1.205900, -77.285100, ARRAY['pasto', 'san juan de pasto']),
  ('neiva', 'Neiva', 'Huila', 'CO', 2.938600, -75.281100, ARRAY['neiva']),
  ('armenia', 'Armenia', 'Quindío', 'CO', 4.533900, -75.681100, ARRAY['armenia']),
  ('monteria', 'Montería', 'Córdoba', 'CO', 8.747980, -75.881430, ARRAY['monteria', 'montería'])
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  department = EXCLUDED.department,
  country_code = EXCLUDED.country_code,
  centroid_lat = EXCLUDED.centroid_lat,
  centroid_lng = EXCLUDED.centroid_lng,
  search_aliases = EXCLUDED.search_aliases,
  is_active = TRUE;

-- ============================================================
-- SEMILLAS: especialidades medicas frecuentes
-- ============================================================
INSERT INTO public.medical_directory_specialties (
  slug, display_name, search_aliases
) VALUES
  ('medicina-general', 'Medicina General', ARRAY['medicina general', 'medico general', 'médico general', 'general']),
  ('pediatria', 'Pediatría', ARRAY['pediatria', 'pediatría', 'pediatra', 'medico pediatra', 'médico pediatra']),
  ('cardiologia', 'Cardiología', ARRAY['cardiologia', 'cardiología', 'cardiologo', 'cardiólogo']),
  ('neurologia', 'Neurología', ARRAY['neurologia', 'neurología', 'neurologo', 'neurólogo']),
  ('dermatologia', 'Dermatología', ARRAY['dermatologia', 'dermatología', 'dermatologo', 'dermatólogo']),
  ('ginecologia', 'Ginecología', ARRAY['ginecologia', 'ginecología', 'ginecologo', 'ginecólogo', 'gineco obstetra', 'gineco-obstetra']),
  ('ortopedia', 'Ortopedia', ARRAY['ortopedia', 'ortopedista', 'traumatologia', 'traumatología', 'traumatologo', 'traumatólogo']),
  ('oftalmologia', 'Oftalmología', ARRAY['oftalmologia', 'oftalmología', 'oftalmologo', 'oftalmólogo']),
  ('otorrinolaringologia', 'Otorrinolaringología', ARRAY['otorrino', 'otorrinolaringologia', 'otorrinolaringología', 'otorrinolaringologo', 'otorrinolaringólogo']),
  ('gastroenterologia', 'Gastroenterología', ARRAY['gastroenterologia', 'gastroenterología', 'gastroenterologo', 'gastroenterólogo']),
  ('endocrinologia', 'Endocrinología', ARRAY['endocrinologia', 'endocrinología', 'endocrinologo', 'endocrinólogo']),
  ('neumologia', 'Neumología', ARRAY['neumologia', 'neumología', 'neumologo', 'neumólogo', 'pulmon']),
  ('psiquiatria', 'Psiquiatría', ARRAY['psiquiatria', 'psiquiatría', 'psiquiatra']),
  ('urologia', 'Urología', ARRAY['urologia', 'urología', 'urologo', 'urólogo']),
  ('nutricion', 'Nutrición', ARRAY['nutricion', 'nutrición', 'nutricionista']),
  ('medicina-interna', 'Medicina Interna', ARRAY['medicina interna', 'internista', 'medico internista', 'médico internista']),
  ('alergologia', 'Alergología', ARRAY['alergologia', 'alergología', 'alergologo', 'alergólogo']),
  ('infectologia', 'Infectología', ARRAY['infectologia', 'infectología', 'infectologo', 'infectólogo'])
ON CONFLICT (slug) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  search_aliases = EXCLUDED.search_aliases,
  is_active = TRUE;
