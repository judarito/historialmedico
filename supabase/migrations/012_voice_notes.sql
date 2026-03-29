-- ============================================================
-- 012 — Soporte de notas de voz en visitas médicas
-- Agrega voice_note_url a medical_visits para almacenar
-- grabaciones de audio asociadas a cada visita.
-- ============================================================

ALTER TABLE medical_visits
  ADD COLUMN IF NOT EXISTS voice_note_url  TEXT,
  ADD COLUMN IF NOT EXISTS voice_note_text TEXT;  -- transcripción de la nota de voz

COMMENT ON COLUMN medical_visits.voice_note_url  IS 'URL pública del audio en Supabase Storage (bucket medical-documents)';
COMMENT ON COLUMN medical_visits.voice_note_text IS 'Transcripción automática de la nota de voz via Whisper';
