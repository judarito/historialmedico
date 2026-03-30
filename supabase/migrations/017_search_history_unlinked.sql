-- ============================================================
-- 017 — search_medical_history: incluir medicamentos y exámenes
--       sin medical_visit_id (no vinculados a ninguna visita)
--
-- Problema de 016: usaba INNER JOIN con medical_visits, por lo
-- que excluía registros creados sin visita vinculada.
--
-- Solución: bloques adicionales para prescriptions y medical_tests
-- con medical_visit_id IS NULL. En ese caso result_type devuelve
-- 'medication' o 'test' (no 'visit') y result_id es el ID del
-- registro, para que el frontend los distinga.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_medical_history(
  p_family_member_id UUID,
  p_query            TEXT
)
RETURNS TABLE (
  result_type  TEXT,
  result_id    UUID,
  title        TEXT,
  subtitle     TEXT,
  date_ref     TIMESTAMPTZ
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

    -- 1. Match directo en la visita
    SELECT
      'visit'::TEXT                                                      AS result_type,
      mv.id                                                              AS result_id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)')  AS title,
      COALESCE(mv.doctor_name, mv.institution_name, '')                 AS subtitle,
      mv.visit_date                                                      AS date_ref,
      1                                                                  AS priority
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

    -- 2. Match por nota de voz
    SELECT
      'visit'::TEXT,
      mv.id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Voz: ' || left(COALESCE(mv.voice_note_text,''), 60),
      mv.visit_date,
      2
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND COALESCE(mv.voice_note_text, '') ILIKE v_pattern

    UNION ALL

    -- 3. Medicamento CON visita vinculada
    SELECT
      'visit'::TEXT,
      mv.id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Medicamento: ' || rx.medication_name,
      mv.visit_date,
      3
    FROM prescriptions rx
    JOIN medical_visits mv ON mv.id = rx.medical_visit_id
    WHERE rx.family_member_id = p_family_member_id
      AND (
        COALESCE(rx.medication_name, '') ILIKE v_pattern OR
        COALESCE(rx.presentation,   '') ILIKE v_pattern OR
        COALESCE(rx.instructions,   '') ILIKE v_pattern
      )

    UNION ALL

    -- 4. Medicamento SIN visita vinculada
    SELECT
      'medication'::TEXT,
      rx.id,
      rx.medication_name,
      COALESCE(
        NULLIF(trim(COALESCE(rx.dose_amount::TEXT,'') || ' ' || COALESCE(rx.dose_unit,'')), ''),
        rx.frequency_text,
        ''
      ),
      rx.start_at,
      3
    FROM prescriptions rx
    WHERE rx.family_member_id = p_family_member_id
      AND rx.medical_visit_id IS NULL
      AND (
        COALESCE(rx.medication_name, '') ILIKE v_pattern OR
        COALESCE(rx.presentation,   '') ILIKE v_pattern OR
        COALESCE(rx.instructions,   '') ILIKE v_pattern
      )

    UNION ALL

    -- 5. Examen CON visita vinculada
    SELECT
      'visit'::TEXT,
      mv.id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Examen: ' || mt.test_name,
      mv.visit_date,
      4
    FROM medical_tests mt
    JOIN medical_visits mv ON mv.id = mt.medical_visit_id
    WHERE mt.family_member_id = p_family_member_id
      AND (
        COALESCE(mt.test_name, '') ILIKE v_pattern OR
        COALESCE(mt.category,  '') ILIKE v_pattern OR
        COALESCE(mt.notes,     '') ILIKE v_pattern
      )

    UNION ALL

    -- 6. Examen SIN visita vinculada
    SELECT
      'test'::TEXT,
      mt.id,
      mt.test_name,
      COALESCE(mt.category, ''),
      mt.ordered_at,
      4
    FROM medical_tests mt
    WHERE mt.family_member_id = p_family_member_id
      AND mt.medical_visit_id IS NULL
      AND (
        COALESCE(mt.test_name, '') ILIKE v_pattern OR
        COALESCE(mt.category,  '') ILIKE v_pattern OR
        COALESCE(mt.notes,     '') ILIKE v_pattern
      )

    UNION ALL

    -- 7. Documento procesado vinculado a visita
    SELECT
      'visit'::TEXT,
      mv.id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Documento: ' || initcap(replace(md.document_type::TEXT, '_', ' ')),
      mv.visit_date,
      5
    FROM medical_documents md
    JOIN medical_visits mv ON mv.id = md.medical_visit_id
    WHERE md.family_member_id = p_family_member_id
      AND md.processing_status IN ('processed', 'verified')
      AND md.parsed_json IS NOT NULL
      AND md.parsed_json::TEXT ILIKE v_pattern

  ),
  -- Para result_type='visit': deduplicar por visit_id conservando mayor prioridad
  -- Para result_type='medication'/'test': siempre incluir (ya son únicos por id)
  ranked AS (
    SELECT DISTINCT ON (result_type, result_id)
      result_type,
      result_id,
      title,
      subtitle,
      date_ref
    FROM candidates
    ORDER BY result_type, result_id, priority ASC
  )
  SELECT r.result_type, r.result_id, r.title, r.subtitle, r.date_ref
  FROM ranked r
  ORDER BY r.date_ref DESC NULLS LAST
  LIMIT 50;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
