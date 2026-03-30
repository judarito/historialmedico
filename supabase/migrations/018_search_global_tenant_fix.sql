-- ============================================================
-- 018 — search_global: buscar también por family_member tenant
--
-- Problema: prescriptions/tests creados con tenant_id incorrecto
-- o NULL no aparecen en search_global (filtra por rx.tenant_id = v_tenant_id).
-- Sin embargo sí aparecen en la pestaña de medicamentos porque
-- esa query filtra por family_member_id.
--
-- Fix: agregar filtro OR usando el tenant de family_members como
-- fuente de verdad secundaria, de modo que si el registro pertenece
-- a un miembro del tenant se incluya aunque su propio tenant_id esté mal.
--
-- También aplica el mismo fix a los bloques de medical_tests,
-- medical_visits y medical_documents.
-- ============================================================

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

  -- 1. Miembros
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

  -- 2. Medicamentos — usa tenant de family_member como fuente de verdad
  SELECT
    'medication'::TEXT,
    'medication'::TEXT,
    rx.id,
    rx.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    rx.medication_name,
    COALESCE(
      NULLIF(trim(COALESCE(rx.dose_amount::TEXT,'') || ' ' || COALESCE(rx.dose_unit,'')), ''),
      rx.frequency_text,
      ''
    ),
    rx.start_at
  FROM prescriptions rx
  JOIN family_members fm ON fm.id = rx.family_member_id
  WHERE fm.tenant_id = v_tenant_id          -- fuente de verdad: tenant del miembro
    AND (
      rx.medication_name              ILIKE v_pattern OR
      COALESCE(rx.presentation,  '') ILIKE v_pattern OR
      COALESCE(rx.instructions,  '') ILIKE v_pattern
    )

  UNION ALL

  -- 3. Visitas — diagnóstico / motivo / notas / voz / institución
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
    AND (
      COALESCE(mv.diagnosis,          '') ILIKE v_pattern OR
      COALESCE(mv.reason_for_visit,   '') ILIKE v_pattern OR
      COALESCE(mv.notes,              '') ILIKE v_pattern OR
      COALESCE(mv.voice_note_text,    '') ILIKE v_pattern OR
      COALESCE(mv.institution_name,   '') ILIKE v_pattern
    )

  UNION ALL

  -- 4. Visitas — médico
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
    AND COALESCE(mv.doctor_name, '') ILIKE v_pattern

  UNION ALL

  -- 5. Visitas — especialidad
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
    AND COALESCE(mv.specialty, '') ILIKE v_pattern

  UNION ALL

  -- 6. Exámenes
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
  WHERE fm.tenant_id = v_tenant_id          -- fuente de verdad: tenant del miembro
    AND (
      mt.test_name              ILIKE v_pattern OR
      COALESCE(mt.category, '') ILIKE v_pattern
    )

  UNION ALL

  -- 7. Documentos procesados (parsed_json de fotos)
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
  LEFT JOIN medical_visits mv ON mv.id = md.medical_visit_id
  WHERE fm.tenant_id = v_tenant_id          -- fuente de verdad: tenant del miembro
    AND md.processing_status IN ('processed', 'verified')
    AND md.parsed_json IS NOT NULL
    AND md.parsed_json::TEXT ILIKE v_pattern

  ORDER BY date_ref DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
