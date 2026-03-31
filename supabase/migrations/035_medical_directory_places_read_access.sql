-- ============================================================
-- Family Health Tracker — Lectura autenticada del directorio medico
-- Migration: 035_medical_directory_places_read_access.sql
-- Permite leer lugares cacheados del directorio desde el cliente
-- ============================================================

DO $$
BEGIN
  CREATE POLICY "Authenticated users can read medical directory places"
  ON public.medical_directory_places
  FOR SELECT
  TO authenticated
  USING (TRUE);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Authenticated users can read medical directory place specialties"
  ON public.medical_directory_place_specialties
  FOR SELECT
  TO authenticated
  USING (TRUE);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT ON public.medical_directory_places TO authenticated;
GRANT SELECT ON public.medical_directory_place_specialties TO authenticated;
