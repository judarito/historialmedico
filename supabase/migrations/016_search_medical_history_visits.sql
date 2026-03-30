-- ============================================================
-- 016 — search_medical_history orientado a visitas
--
-- Cambia el enfoque: en lugar de devolver medicamentos/exámenes
-- como resultados separados, devuelve las VISITAS que coinciden
-- con cualquier criterio (diagnóstico, médico, institución,
-- notas, voz, medicamento asociado, examen asociado).
--
-- Nuevas columnas devueltas:
--   visit_id     — ID de la visita (para navegar al detalle)
--   visit_date   — fecha de la visita
--   doctor_name  — médico
--   specialty    — especialidad
--   diagnosis    — diagnóstico
--   match_reason — qué campo generó el match
--   match_detail — valor que coincidió (para mostrar en UI)
--
-- Los resultados se deduplictan por visit_id; si hay varios
-- motivos de match en la misma visita se conserva el más
-- relevante (orden: visita > medicamento > examen > voz > documento).
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_medical_history(
  p_family_member_id UUID,
  p_query            TEXT
)
RETURNS TABLE (
  result_type  TEXT,        -- siempre 'visit' (por compatibilidad)
  result_id    UUID,        -- visit_id
  title        TEXT,        -- diagnóstico o motivo
  subtitle     TEXT,        -- médico / institución / motivo del match
  date_ref     TIMESTAMPTZ  -- fecha de la visita
) AS $$
DECLARE
  v_tenant_id UUID;
  v_pattern   TEXT := '%' || p_query || '%';
BEGIN
  SELECT fm.tenant_id INTO v_tenant_id
  FROM family_members fm
  WHERE fm.id = p_family_member_id;

  IF NOT user_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  WITH candidates AS (

    -- 1. Match directo en la visita (prioridad 1)
    SELECT
      mv.id                                                          AS visit_id,
      mv.visit_date,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)') AS title,
      COALESCE(mv.doctor_name, mv.institution_name, '')              AS subtitle,
      1                                                              AS priority
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND (
        COALESCE(mv.diagnosis,          '') ILIKE v_pattern OR
        COALESCE(mv.reason_for_visit,   '') ILIKE v_pattern OR
        COALESCE(mv.doctor_name,        '') ILIKE v_pattern OR
        COALESCE(mv.institution_name,   '') ILIKE v_pattern OR
        COALESCE(mv.specialty,          '') ILIKE v_pattern OR
        COALESCE(mv.notes,              '') ILIKE v_pattern
      )

    UNION ALL

    -- 2. Match por nota de voz (prioridad 2)
    SELECT
      mv.id,
      mv.visit_date,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Voz: ' || left(mv.voice_note_text, 60),
      2
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND COALESCE(mv.voice_note_text, '') ILIKE v_pattern

    UNION ALL

    -- 3. Match por medicamento vinculado (prioridad 3)
    SELECT
      mv.id,
      mv.visit_date,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Medicamento: ' || rx.medication_name,
      3
    FROM prescriptions rx
    JOIN medical_visits mv ON mv.id = rx.medical_visit_id
    WHERE rx.family_member_id = p_family_member_id
      AND mv.id IS NOT NULL
      AND (
        COALESCE(rx.medication_name, '') ILIKE v_pattern OR
        COALESCE(rx.presentation,   '') ILIKE v_pattern OR
        COALESCE(rx.instructions,   '') ILIKE v_pattern
      )

    UNION ALL

    -- 4. Match por examen vinculado (prioridad 4)
    SELECT
      mv.id,
      mv.visit_date,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Examen: ' || mt.test_name,
      4
    FROM medical_tests mt
    JOIN medical_visits mv ON mv.id = mt.medical_visit_id
    WHERE mt.family_member_id = p_family_member_id
      AND mv.id IS NOT NULL
      AND (
        COALESCE(mt.test_name, '') ILIKE v_pattern OR
        COALESCE(mt.category,  '') ILIKE v_pattern OR
        COALESCE(mt.notes,     '') ILIKE v_pattern
      )

    UNION ALL

    -- 5. Match por documento procesado (parsed_json) — prioridad 5
    SELECT
      mv.id,
      mv.visit_date,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Documento: ' || initcap(replace(md.document_type::TEXT, '_', ' ')),
      5
    FROM medical_documents md
    JOIN medical_visits mv ON mv.id = md.medical_visit_id
    WHERE md.family_member_id = p_family_member_id
      AND mv.id IS NOT NULL
      AND md.processing_status IN ('processed', 'verified')
      AND md.parsed_json IS NOT NULL
      AND md.parsed_json::TEXT ILIKE v_pattern

  ),
  -- Deduplicar: conservar el match de mayor prioridad por visita
  ranked AS (
    SELECT DISTINCT ON (visit_id)
      visit_id,
      visit_date,
      title,
      subtitle,
      priority
    FROM candidates
    ORDER BY visit_id, priority ASC
  )
  SELECT
    'visit'::TEXT,
    r.visit_id,
    r.title,
    r.subtitle,
    r.visit_date
  FROM ranked r
  ORDER BY r.visit_date DESC NULLS LAST
  LIMIT 50;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
