-- ============================================================
-- 039 — Ciudad preferida en perfil + soporte fuente REPS
-- ============================================================

-- 1. Ciudad preferida en perfil de usuario
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_city_slug TEXT REFERENCES public.medical_directory_cities(slug) ON DELETE SET NULL;

-- 2. Nombre exacto del municipio en API REPS para cada ciudad del directorio
ALTER TABLE public.medical_directory_cities
  ADD COLUMN IF NOT EXISTS reps_municipality_name TEXT;

-- Mapeo de ciudades conocidas → nombre exacto en la API REPS
UPDATE public.medical_directory_cities SET reps_municipality_name = 'BOGOTÁ D.C.'    WHERE slug = 'bogota';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'MEDELLÍN'        WHERE slug = 'medellin';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'CALI'            WHERE slug = 'cali';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'BARRANQUILLA'    WHERE slug = 'barranquilla';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'CARTAGENA'       WHERE slug = 'cartagena';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'BUCARAMANGA'     WHERE slug = 'bucaramanga';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'CÚCUTA'          WHERE slug = 'cucuta';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'PEREIRA'         WHERE slug = 'pereira';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'MANIZALES'       WHERE slug = 'manizales';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'IBAGUÉ'          WHERE slug = 'ibague';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'SANTA MARTA'     WHERE slug = 'santa-marta';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'VILLAVICENCIO'   WHERE slug = 'villavicencio';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'MONTERÍA'        WHERE slug = 'monteria';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'PASTO'           WHERE slug = 'pasto';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'ARMENIA'         WHERE slug = 'armenia';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'NEIVA'           WHERE slug = 'neiva';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'SINCELEJO'       WHERE slug = 'sincelejo';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'TUNJA'           WHERE slug = 'tunja';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'POPAYÁN'         WHERE slug = 'popayan';
UPDATE public.medical_directory_cities SET reps_municipality_name = 'VALLEDUPAR'      WHERE slug = 'valledupar';

-- 3. Columna source en medical_directory_places para saber el origen
ALTER TABLE public.medical_directory_places
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'google'
  CHECK (source IN ('google', 'reps', 'manual'));

ALTER TABLE public.medical_directory_places
  ADD COLUMN IF NOT EXISTS reps_code TEXT;

-- Índice para búsquedas por fuente
CREATE INDEX IF NOT EXISTS idx_medical_directory_places_source
  ON public.medical_directory_places(source);

-- RPC: obtener ciudad preferida del perfil
CREATE OR REPLACE FUNCTION get_preferred_city()
RETURNS TABLE(slug TEXT, name TEXT, reps_municipality_name TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT c.slug, c.name, c.reps_municipality_name
    FROM profiles p
    JOIN medical_directory_cities c ON c.slug = p.preferred_city_slug
    WHERE p.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_preferred_city() TO authenticated;

-- RPC: guardar ciudad preferida
CREATE OR REPLACE FUNCTION set_preferred_city(p_city_slug TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_city_slug IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM medical_directory_cities WHERE slug = p_city_slug AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Ciudad no válida: %', p_city_slug;
  END IF;

  UPDATE profiles
  SET preferred_city_slug = p_city_slug, updated_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_preferred_city(TEXT) TO authenticated;
