-- ============================================================
-- Family Health Tracker — Cache de detalle para directorio medico
-- Migration: 033_medical_directory_place_details_cache.sql
-- ============================================================

ALTER TABLE public.medical_directory_places
  ADD COLUMN IF NOT EXISTS international_phone TEXT,
  ADD COLUMN IF NOT EXISTS website_uri TEXT,
  ADD COLUMN IF NOT EXISTS current_opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS regular_opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS detail_last_google_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detail_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_medical_directory_places_detail_expires_at
  ON public.medical_directory_places(detail_expires_at);
