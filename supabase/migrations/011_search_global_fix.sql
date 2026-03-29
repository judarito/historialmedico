-- ============================================================
-- 011 — Corregir búsqueda global: lookup de tenant_id
-- Problema: usaba profiles.tenant_id que puede ser NULL.
-- Fix: busca en tenant_users que siempre existe al crear tenant.
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
  -- Lookup robusto: tenant_users siempre tiene registro al crear tenant
  SELECT tu.tenant_id INTO v_tenant_id
  FROM tenant_users tu
  WHERE tu.user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant asignado';
  END IF;

  RETURN QUERY

  -- 1. Miembros (por nombre)
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
      fm.first_name ILIKE v_pattern OR
      COALESCE(fm.last_name, '') ILIKE v_pattern
    )

  UNION ALL

  -- 2. Medicamentos
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
  WHERE rx.tenant_id = v_tenant_id
    AND (
      rx.medication_name              ILIKE v_pattern OR
      COALESCE(rx.presentation,  '') ILIKE v_pattern OR
      COALESCE(rx.instructions,  '') ILIKE v_pattern
    )

  UNION ALL

  -- 3. Visitas — por diagnóstico / motivo / notas
  SELECT
    'visit'::TEXT,
    'diagnosis'::TEXT,
    mv.id,
    mv.family_member_id,
    trim(fm.first_name || ' ' || COALESCE(fm.last_name, '')),
    COALESCE(mv.diagnosis, mv.reason_for_visit, ''),
    COALESCE(mv.doctor_name, mv.institution_name, ''),
    mv.visit_date
  FROM medical_visits mv
  JOIN family_members fm ON fm.id = mv.family_member_id
  WHERE mv.tenant_id = v_tenant_id
    AND (
      COALESCE(mv.diagnosis,        '') ILIKE v_pattern OR
      COALESCE(mv.reason_for_visit, '') ILIKE v_pattern OR
      COALESCE(mv.notes,            '') ILIKE v_pattern
    )

  UNION ALL

  -- 4. Visitas — por médico
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
  WHERE mv.tenant_id = v_tenant_id
    AND COALESCE(mv.doctor_name, '') ILIKE v_pattern

  UNION ALL

  -- 5. Visitas — por especialidad
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
  WHERE mv.tenant_id = v_tenant_id
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
  WHERE mt.tenant_id = v_tenant_id
    AND (
      mt.test_name                    ILIKE v_pattern OR
      COALESCE(mt.category, '')       ILIKE v_pattern
    )

  ORDER BY date_ref DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
