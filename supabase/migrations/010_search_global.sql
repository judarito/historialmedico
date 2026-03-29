-- ============================================================
-- 010 — Búsqueda global por tenant
-- Busca en todos los miembros de la familia del usuario autenticado.
-- Cubre: nombre de miembro, medicamentos, diagnósticos,
--        médicos, especialidades y exámenes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_global(
  p_query  TEXT,
  p_limit  INTEGER DEFAULT 40
)
RETURNS TABLE (
  result_type     TEXT,        -- 'member' | 'medication' | 'visit' | 'test'
  filter_category TEXT,        -- 'member' | 'medication' | 'diagnosis' | 'doctor' | 'specialist' | 'test'
  result_id       UUID,        -- ID del registro (visita, prescripción, etc.)
  member_id       UUID,
  member_name     TEXT,
  title           TEXT,
  subtitle        TEXT,
  date_ref        TIMESTAMPTZ
) AS $$
DECLARE
  v_tenant_id UUID;
  v_pattern   TEXT := '%' || lower(p_query) || '%';
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM profiles
  WHERE id = auth.uid();

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
      lower(fm.first_name) ILIKE v_pattern OR
      lower(COALESCE(fm.last_name, '')) ILIKE v_pattern
    )

  UNION ALL

  -- 2. Medicamentos (por nombre, presentación o instrucciones)
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
      lower(rx.medication_name) ILIKE v_pattern OR
      lower(COALESCE(rx.presentation, '')) ILIKE v_pattern OR
      lower(COALESCE(rx.instructions,  '')) ILIKE v_pattern
    )

  UNION ALL

  -- 3. Visitas — por diagnóstico
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
      lower(COALESCE(mv.diagnosis,        '')) ILIKE v_pattern OR
      lower(COALESCE(mv.reason_for_visit, '')) ILIKE v_pattern OR
      lower(COALESCE(mv.notes,            '')) ILIKE v_pattern
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
    AND lower(COALESCE(mv.doctor_name, '')) ILIKE v_pattern

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
    AND lower(COALESCE(mv.specialty, '')) ILIKE v_pattern

  UNION ALL

  -- 6. Exámenes (por nombre o categoría)
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
      lower(mt.test_name)                  ILIKE v_pattern OR
      lower(COALESCE(mt.category, ''))     ILIKE v_pattern
    )

  ORDER BY date_ref DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
