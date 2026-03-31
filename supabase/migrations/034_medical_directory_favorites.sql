-- ============================================================
-- Family Health Tracker — Favoritos del directorio medico
-- Migration: 034_medical_directory_favorites.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.medical_directory_favorites (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id   UUID NOT NULL REFERENCES public.medical_directory_places(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_medical_directory_favorites_user_id
  ON public.medical_directory_favorites(user_id);

CREATE INDEX IF NOT EXISTS idx_medical_directory_favorites_place_id
  ON public.medical_directory_favorites(place_id);

DROP TRIGGER IF EXISTS trg_medical_directory_favorites_updated_at
ON public.medical_directory_favorites;
CREATE TRIGGER trg_medical_directory_favorites_updated_at
BEFORE UPDATE ON public.medical_directory_favorites
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.medical_directory_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Users can read own medical directory favorites"
  ON public.medical_directory_favorites
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can insert own medical directory favorites"
  ON public.medical_directory_favorites
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Users can delete own medical directory favorites"
  ON public.medical_directory_favorites
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, DELETE ON public.medical_directory_favorites TO authenticated;
