-- ============================================================
-- 019 — soft delete de visitas + borrado seguro de adjuntos
--
-- Objetivos:
--   - Las visitas no se borran físicamente; se marcan con deleted_at/deleted_by
--   - Los adjuntos sí se pueden eliminar individualmente
--   - No permitir borrar un adjunto si ya generó medicamentos o exámenes confirmados
--   - Excluir visitas soft-deleted de search_global y search_medical_history
-- ============================================================

ALTER TABLE medical_visits
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_medical_visits_deleted_at
  ON medical_visits(deleted_at);

CREATE OR REPLACE FUNCTION public.soft_delete_medical_visit(
  p_visit_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_visit RECORD;
BEGIN
  SELECT * INTO v_visit
  FROM medical_visits
  WHERE id = p_visit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visita no encontrada: %', p_visit_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_visit.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  IF v_visit.deleted_at IS NOT NULL THEN
    RETURN TRUE;
  END IF;

  UPDATE medical_visits
  SET
    status     = 'cancelled',
    deleted_at = NOW(),
    deleted_by = auth.uid(),
    updated_at = NOW()
  WHERE id = p_visit_id;

  PERFORM log_audit_event(
    v_visit.tenant_id,
    'SOFT_DELETE_VISIT',
    'medical_visits',
    p_visit_id,
    jsonb_build_object(
      'previous_status', v_visit.status,
      'deleted_at', NOW()
    )
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_medical_document_attachment(
  p_document_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_doc RECORD;
  v_has_prescriptions BOOLEAN := FALSE;
  v_has_tests BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_doc
  FROM medical_documents
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjunto no encontrado: %', p_document_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_doc.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM prescriptions
    WHERE medical_document_id = p_document_id
  ) INTO v_has_prescriptions;

  SELECT EXISTS(
    SELECT 1
    FROM medical_tests
    WHERE medical_document_id = p_document_id
  ) INTO v_has_tests;

  IF v_has_prescriptions OR v_has_tests THEN
    RAISE EXCEPTION 'Este adjunto ya generó datos clínicos confirmados y no se puede eliminar.';
  END IF;

  DELETE FROM medical_documents
  WHERE id = p_document_id;

  PERFORM log_audit_event(
    v_doc.tenant_id,
    'DELETE_MEDICAL_DOCUMENT_ATTACHMENT',
    'medical_documents',
    p_document_id,
    jsonb_build_object(
      'document_type', v_doc.document_type,
      'medical_visit_id', v_doc.medical_visit_id,
      'file_path', v_doc.file_path
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'document_id', p_document_id,
    'file_path', v_doc.file_path,
    'medical_visit_id', v_doc.medical_visit_id,
    'document_type', v_doc.document_type
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

    SELECT
      'visit'::TEXT                                                      AS result_type,
      mv.id                                                              AS result_id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)')  AS title,
      COALESCE(mv.doctor_name, mv.institution_name, '')                 AS subtitle,
      mv.visit_date                                                      AS date_ref,
      1                                                                  AS priority
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND mv.deleted_at IS NULL
      AND (
        COALESCE(mv.diagnosis,          '') ILIKE v_pattern OR
        COALESCE(mv.reason_for_visit,   '') ILIKE v_pattern OR
        COALESCE(mv.doctor_name,        '') ILIKE v_pattern OR
        COALESCE(mv.institution_name,   '') ILIKE v_pattern OR
        COALESCE(mv.specialty,          '') ILIKE v_pattern OR
        COALESCE(mv.notes,              '') ILIKE v_pattern
      )

    UNION ALL

    SELECT
      'visit'::TEXT,
      mv.id,
      COALESCE(mv.diagnosis, mv.reason_for_visit, '(sin diagnóstico)'),
      'Voz: ' || left(COALESCE(mv.voice_note_text, ''), 60),
      mv.visit_date,
      2
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND mv.deleted_at IS NULL
      AND COALESCE(mv.voice_note_text, '') ILIKE v_pattern

    UNION ALL

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
      AND mv.deleted_at IS NULL
      AND (
        COALESCE(rx.medication_name, '') ILIKE v_pattern OR
        COALESCE(rx.presentation,   '') ILIKE v_pattern OR
        COALESCE(rx.instructions,   '') ILIKE v_pattern
      )

    UNION ALL

    SELECT
      'medication'::TEXT,
      rx.id,
      rx.medication_name,
      COALESCE(
        NULLIF(trim(COALESCE(rx.dose_amount::TEXT, '') || ' ' || COALESCE(rx.dose_unit, '')), ''),
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
      AND mv.deleted_at IS NULL
      AND (
        COALESCE(mt.test_name, '') ILIKE v_pattern OR
        COALESCE(mt.category,  '') ILIKE v_pattern OR
        COALESCE(mt.notes,     '') ILIKE v_pattern
      )

    UNION ALL

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
      AND mv.deleted_at IS NULL
      AND md.processing_status IN ('processed', 'verified')
      AND md.parsed_json IS NOT NULL
      AND md.parsed_json::TEXT ILIKE v_pattern

  ),
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

CREATE OR REPLACE FUNCTION public.search_global(
  p_query  TEXT,
  p_limit  INTEGER DEFAULT 40
)
RETURNS TABLE (
  result_type     TEXT,
  filter_category TEXT,
  result_id       UUID,
  member_id       UUID,
  member_name     TEXT,
  title           TEXT,
  subtitle        TEXT,
  date_ref        TIMESTAMPTZ
) AS $$
DECLARE
  v_tenant_id UUID;
  v_pattern   TEXT := '%' || p_query || '%';
BEGIN
  SELECT tu.tenant_id INTO v_tenant_id
  FROM tenant_users tu
  WHERE tu.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant asignado';
  END IF;

  RETURN QUERY

  SELECT
    'member'::TEXT,
    'member'::TEXT,
    fm.id,
    fm.id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(fm.eps_name, fm.relationship::TEXT, ''),
    fm.created_at
  FROM family_members fm
  WHERE fm.tenant_id = v_tenant_id
    AND (
      fm.first_name              ILIKE v_pattern OR
      COALESCE(fm.last_name, '') ILIKE v_pattern
    )

  UNION ALL

  SELECT
    'medication'::TEXT,
    'medication'::TEXT,
    rx.id,
    rx.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    rx.medication_name,
    COALESCE(
      NULLIF(trim(COALESCE(rx.dose_amount::TEXT, '') || ' ' || COALESCE(rx.dose_unit, '')), ''),
      rx.frequency_text,
      ''
    ),
    rx.start_at
  FROM prescriptions rx
  JOIN family_members fm ON fm.id = rx.family_member_id
  WHERE fm.tenant_id = v_tenant_id
    AND (
      rx.medication_name             ILIKE v_pattern OR
      COALESCE(rx.presentation, '') ILIKE v_pattern OR
      COALESCE(rx.instructions, '') ILIKE v_pattern
    )

  UNION ALL

  SELECT
    'visit'::TEXT,
    'diagnosis'::TEXT,
    mv.id,
    mv.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(mv.diagnosis, mv.reason_for_visit, left(mv.voice_note_text, 80), ''),
    COALESCE(mv.doctor_name, mv.institution_name, ''),
    mv.visit_date
  FROM medical_visits mv
  JOIN family_members fm ON fm.id = mv.family_member_id
  WHERE fm.tenant_id = v_tenant_id
    AND mv.deleted_at IS NULL
    AND (
      COALESCE(mv.diagnosis,          '') ILIKE v_pattern OR
      COALESCE(mv.reason_for_visit,   '') ILIKE v_pattern OR
      COALESCE(mv.notes,              '') ILIKE v_pattern OR
      COALESCE(mv.voice_note_text,    '') ILIKE v_pattern OR
      COALESCE(mv.institution_name,   '') ILIKE v_pattern
    )

  UNION ALL

  SELECT
    'visit'::TEXT,
    'doctor'::TEXT,
    mv.id,
    mv.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(mv.doctor_name, ''),
    COALESCE(mv.institution_name, mv.specialty, ''),
    mv.visit_date
  FROM medical_visits mv
  JOIN family_members fm ON fm.id = mv.family_member_id
  WHERE fm.tenant_id = v_tenant_id
    AND mv.deleted_at IS NULL
    AND COALESCE(mv.doctor_name, '') ILIKE v_pattern

  UNION ALL

  SELECT
    'visit'::TEXT,
    'specialist'::TEXT,
    mv.id,
    mv.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(mv.specialty, ''),
    COALESCE(mv.doctor_name, mv.institution_name, ''),
    mv.visit_date
  FROM medical_visits mv
  JOIN family_members fm ON fm.id = mv.family_member_id
  WHERE fm.tenant_id = v_tenant_id
    AND mv.deleted_at IS NULL
    AND COALESCE(mv.specialty, '') ILIKE v_pattern

  UNION ALL

  SELECT
    'test'::TEXT,
    'test'::TEXT,
    mt.id,
    mt.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    mt.test_name,
    COALESCE(mt.category, ''),
    mt.ordered_at
  FROM medical_tests mt
  JOIN family_members fm ON fm.id = mt.family_member_id
  WHERE fm.tenant_id = v_tenant_id
    AND (
      mt.test_name              ILIKE v_pattern OR
      COALESCE(mt.category, '') ILIKE v_pattern
    )

  UNION ALL

  SELECT
    'document'::TEXT,
    'document'::TEXT,
    md.id,
    md.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(
      mv.diagnosis,
      mv.reason_for_visit,
      initcap(replace(md.document_type::TEXT, '_', ' '))
    ),
    COALESCE(mv.doctor_name, '') ||
      CASE WHEN mv.visit_date IS NOT NULL
           THEN ' · ' || to_char(mv.visit_date, 'DD Mon YYYY')
           ELSE '' END,
    COALESCE(mv.visit_date, md.created_at)
  FROM medical_documents md
  JOIN family_members fm ON fm.id = md.family_member_id
  LEFT JOIN medical_visits mv ON mv.id = md.medical_visit_id AND mv.deleted_at IS NULL
  WHERE fm.tenant_id = v_tenant_id
    AND (md.medical_visit_id IS NULL OR mv.id IS NOT NULL)
    AND md.processing_status IN ('processed', 'verified')
    AND md.parsed_json IS NOT NULL
    AND md.parsed_json::TEXT ILIKE v_pattern

  ORDER BY date_ref DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
