-- ============================================================
-- 009 — Vincular medical_documents a medical_visits
-- Los documentos (fotos, resultados, fórmulas) ahora pertenecen
-- a una visita médica específica en lugar de ser registros sueltos.
-- ============================================================

ALTER TABLE medical_documents
  ADD COLUMN IF NOT EXISTS medical_visit_id UUID
    REFERENCES medical_visits(id) ON DELETE SET NULL;

-- Índice para consultas por visita
CREATE INDEX IF NOT EXISTS idx_medical_documents_visit
  ON medical_documents(medical_visit_id)
  WHERE medical_visit_id IS NOT NULL;
