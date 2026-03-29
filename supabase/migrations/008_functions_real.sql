-- ============================================================
-- Family Health Tracker — Funciones Helper (schema real)
-- Migration: 008_functions_real.sql
-- Usa nombres de columnas reales del schema existente
-- ============================================================

-- ============================================================
-- RPC: create_tenant_with_owner
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_name TEXT,
  p_slug TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id   UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug) THEN
    RAISE EXCEPTION 'El slug "%" ya está en uso', p_slug;
  END IF;

  INSERT INTO tenants (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_tenant_id;

  -- Agregar al usuario como owner
  INSERT INTO tenant_users (tenant_id, user_id, role, joined_at)
  VALUES (v_tenant_id, v_user_id, 'owner', NOW());

  -- Vincular el perfil al tenant principal
  UPDATE profiles
  SET tenant_id = v_tenant_id
  WHERE id = v_user_id;

  PERFORM log_audit_event(
    v_tenant_id, 'CREATE_TENANT', 'tenants', v_tenant_id,
    jsonb_build_object('name', p_name, 'slug', p_slug)
  );

  RETURN jsonb_build_object('tenant_id', v_tenant_id, 'success', TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: generate_medication_schedule
-- Genera horarios de dosis para un medicamento (prescription)
-- Usa: prescriptions.prescription_id, interval_hours, duration_days,
--      start_at, family_member_id, family_id, tenant_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_medication_schedule(
  p_prescription_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_rx         RECORD;
  v_current    TIMESTAMPTZ;
  v_end_time   TIMESTAMPTZ;
  v_interval   INTERVAL;
  v_dose_num   INTEGER := 1;
  v_count      INTEGER := 0;
BEGIN
  -- Obtener datos del medicamento
  SELECT * INTO v_rx
  FROM prescriptions
  WHERE id = p_prescription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicamento no encontrado: %', p_prescription_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_rx.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Si es "según necesidad" no se genera horario
  IF v_rx.is_as_needed THEN
    RETURN 0;
  END IF;

  -- Calcular intervalo entre dosis
  IF v_rx.interval_hours IS NOT NULL AND v_rx.interval_hours > 0 THEN
    v_interval := (v_rx.interval_hours || ' hours')::INTERVAL;
  ELSIF v_rx.times_per_day IS NOT NULL AND v_rx.times_per_day > 0 THEN
    v_interval := (24.0 / v_rx.times_per_day || ' hours')::INTERVAL;
  ELSE
    v_interval := '8 hours'::INTERVAL; -- fallback: 3 veces al día
  END IF;

  -- Fecha de inicio
  v_current := COALESCE(v_rx.start_at, NOW());

  -- Fecha de fin
  IF v_rx.end_at IS NOT NULL THEN
    v_end_time := v_rx.end_at;
  ELSIF v_rx.duration_days IS NOT NULL AND v_rx.duration_days > 0 THEN
    v_end_time := v_current + (v_rx.duration_days || ' days')::INTERVAL;
  ELSE
    v_end_time := v_current + '30 days'::INTERVAL; -- fallback 30 días
  END IF;

  -- Limpiar horarios pendientes previos
  DELETE FROM medication_schedules
  WHERE prescription_id = p_prescription_id
    AND status = 'pending';

  -- Generar dosis
  WHILE v_current <= v_end_time LOOP
    INSERT INTO medication_schedules (
      tenant_id,
      family_id,
      family_member_id,
      prescription_id,
      scheduled_at,
      dose_number,
      dose_label,
      status
    ) VALUES (
      v_rx.tenant_id,
      v_rx.family_id,
      v_rx.family_member_id,
      p_prescription_id,
      v_current,
      v_dose_num,
      'Dosis ' || v_dose_num,
      'pending'
    );

    v_current  := v_current + v_interval;
    v_dose_num := v_dose_num + 1;
    v_count    := v_count + 1;

    IF v_count >= 500 THEN EXIT; END IF; -- límite de seguridad
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: mark_dose
-- Marca una dosis como taken / skipped / late / cancelled
-- Usa columnas reales: taken_at, skipped_at, marked_by, status
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_dose(
  p_schedule_id UUID,
  p_status      schedule_status,  -- enum real del schema
  p_notes       TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_sch RECORD;
BEGIN
  SELECT ms.*, p.tenant_id INTO v_sch
  FROM medication_schedules ms
  JOIN prescriptions p ON p.id = ms.prescription_id
  WHERE ms.id = p_schedule_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Horario de dosis no encontrado: %', p_schedule_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_sch.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  UPDATE medication_schedules
  SET
    status     = p_status,
    taken_at   = CASE WHEN p_status IN ('taken', 'late')    THEN NOW() ELSE NULL END,
    skipped_at = CASE WHEN p_status = 'skipped'             THEN NOW() ELSE NULL END,
    marked_by  = auth.uid(),
    notes      = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_schedule_id;

  PERFORM log_audit_event(
    v_sch.tenant_id,
    'MARK_DOSE_' || UPPER(p_status::TEXT),
    'medication_schedules',
    p_schedule_id,
    jsonb_build_object('status', p_status, 'marked_at', NOW())
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: get_pending_doses_today
-- Dosis pendientes del día para un familiar
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pending_doses_today(
  p_family_member_id UUID
)
RETURNS TABLE (
  schedule_id       UUID,
  prescription_id   UUID,
  medication_name   TEXT,
  dose_amount       NUMERIC,
  dose_unit         TEXT,
  route             medication_route,
  scheduled_at      TIMESTAMPTZ,
  dose_label        TEXT,
  status            schedule_status
) AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT fm.tenant_id INTO v_tenant_id
  FROM family_members fm
  WHERE fm.id = p_family_member_id;

  IF NOT user_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  SELECT
    ms.id,
    ms.prescription_id,
    rx.medication_name,
    rx.dose_amount,
    rx.dose_unit,
    rx.route,
    ms.scheduled_at,
    ms.dose_label,
    ms.status
  FROM medication_schedules ms
  JOIN prescriptions rx ON rx.id = ms.prescription_id
  WHERE ms.family_member_id = p_family_member_id
    AND ms.scheduled_at >= (NOW() AT TIME ZONE 'America/Bogota')::DATE
    AND ms.scheduled_at <  (NOW() AT TIME ZONE 'America/Bogota')::DATE + '1 day'::INTERVAL
    AND ms.status = 'pending'
  ORDER BY ms.scheduled_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: get_active_medications
-- Medicamentos activos de un familiar
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_medications(
  p_family_member_id UUID
)
RETURNS TABLE (
  prescription_id   UUID,
  medication_name   TEXT,
  presentation      TEXT,
  dose_amount       NUMERIC,
  dose_unit         TEXT,
  frequency_text    TEXT,
  route             medication_route,
  start_at          TIMESTAMPTZ,
  end_at            TIMESTAMPTZ,
  is_as_needed      BOOLEAN,
  pending_doses_today INTEGER
) AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT fm.tenant_id INTO v_tenant_id
  FROM family_members fm
  WHERE fm.id = p_family_member_id;

  IF NOT user_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  SELECT
    rx.id,
    rx.medication_name,
    rx.presentation,
    rx.dose_amount,
    rx.dose_unit,
    rx.frequency_text,
    rx.route,
    rx.start_at,
    rx.end_at,
    rx.is_as_needed,
    (
      SELECT COUNT(*)::INTEGER
      FROM medication_schedules ms
      WHERE ms.prescription_id   = rx.id
        AND ms.status             = 'pending'
        AND ms.scheduled_at      >= (NOW() AT TIME ZONE 'America/Bogota')::DATE
        AND ms.scheduled_at      <  (NOW() AT TIME ZONE 'America/Bogota')::DATE + '1 day'::INTERVAL
    ) AS pending_doses_today
  FROM prescriptions rx
  WHERE rx.family_member_id = p_family_member_id
    AND rx.status = 'active'
  ORDER BY rx.start_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: get_pending_tests
-- Exámenes pendientes de un familiar
-- Usa medical_tests con columnas reales: test_name, status, due_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pending_tests(
  p_family_member_id UUID
)
RETURNS TABLE (
  test_id        UUID,
  test_name      TEXT,
  category       TEXT,
  status         test_status,
  ordered_at     TIMESTAMPTZ,
  due_at         TIMESTAMPTZ,
  scheduled_at   TIMESTAMPTZ,
  document_id    UUID
) AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT fm.tenant_id INTO v_tenant_id
  FROM family_members fm
  WHERE fm.id = p_family_member_id;

  IF NOT user_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  SELECT
    mt.id,
    mt.test_name,
    mt.category,
    mt.status,
    mt.ordered_at,
    mt.due_at,
    mt.scheduled_at,
    mt.medical_document_id
  FROM medical_tests mt
  WHERE mt.family_member_id = p_family_member_id
    AND mt.status IN ('pending', 'scheduled')
  ORDER BY COALESCE(mt.due_at, mt.ordered_at) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: search_medical_history
-- Búsqueda global en historial de un familiar
-- Usa columnas reales: medication_name, reason_for_visit, test_name
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

  -- Visitas médicas (diagnosis, reason_for_visit, doctor_name)
  SELECT
    'visit'::TEXT,
    mv.id,
    COALESCE(mv.diagnosis, mv.reason_for_visit),
    COALESCE(mv.doctor_name, mv.institution_name),
    mv.visit_date
  FROM medical_visits mv
  WHERE mv.family_member_id = p_family_member_id
    AND (
      mv.diagnosis        ILIKE v_pattern OR
      mv.reason_for_visit ILIKE v_pattern OR
      mv.doctor_name      ILIKE v_pattern OR
      mv.institution_name ILIKE v_pattern OR
      mv.notes            ILIKE v_pattern
    )

  UNION ALL

  -- Medicamentos (medication_name, presentation, instructions)
  SELECT
    'medication'::TEXT,
    rx.id,
    rx.medication_name,
    COALESCE(rx.presentation, rx.dose_amount::TEXT || ' ' || COALESCE(rx.dose_unit, '')),
    rx.start_at
  FROM prescriptions rx
  WHERE rx.family_member_id = p_family_member_id
    AND (
      rx.medication_name ILIKE v_pattern OR
      rx.presentation    ILIKE v_pattern OR
      rx.instructions    ILIKE v_pattern
    )

  UNION ALL

  -- Exámenes (test_name, category, notes)
  SELECT
    'test'::TEXT,
    mt.id,
    mt.test_name,
    mt.category,
    mt.ordered_at
  FROM medical_tests mt
  WHERE mt.family_member_id = p_family_member_id
    AND (
      mt.test_name ILIKE v_pattern OR
      mt.category  ILIKE v_pattern OR
      mt.notes     ILIKE v_pattern
    )

  ORDER BY date_ref DESC NULLS LAST
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: confirm_document_and_create_records
-- Confirma los datos de un documento procesado por IA
-- y crea los registros de prescriptions y medical_tests
-- Centraliza la lógica de "confirmar fórmula"
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_document_and_create_records(
  p_document_id      UUID,
  p_medications      JSONB,   -- array de objetos de medicamentos
  p_tests            JSONB    -- array de objetos de exámenes
)
RETURNS JSONB AS $$
DECLARE
  v_doc           RECORD;
  v_user_id       UUID := auth.uid();
  v_med           JSONB;
  v_test          JSONB;
  v_rx_id         UUID;
  v_test_id       UUID;
  v_rx_ids        UUID[] := '{}';
  v_test_ids      UUID[] := '{}';
BEGIN
  -- Obtener documento
  SELECT * INTO v_doc
  FROM medical_documents
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento no encontrado: %', p_document_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_doc.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  -- Crear prescripciones (medicamentos)
  FOR v_med IN SELECT * FROM jsonb_array_elements(p_medications)
  LOOP
    INSERT INTO prescriptions (
      tenant_id,
      family_id,
      family_member_id,
      medical_visit_id,
      medical_document_id,
      medication_name,
      presentation,
      dose_amount,
      dose_unit,
      frequency_text,
      interval_hours,
      times_per_day,
      duration_days,
      route,
      instructions,
      start_at,
      end_at,
      is_as_needed,
      status,
      created_by
    ) VALUES (
      v_doc.tenant_id,
      v_doc.family_id,
      v_doc.family_member_id,
      v_doc.medical_visit_id,
      p_document_id,
      v_med->>'medication_name',
      v_med->>'presentation',
      (v_med->>'dose_amount')::NUMERIC,
      v_med->>'dose_unit',
      v_med->>'frequency_text',
      (v_med->>'interval_hours')::INTEGER,
      (v_med->>'times_per_day')::NUMERIC,
      (v_med->>'duration_days')::INTEGER,
      COALESCE((v_med->>'route')::medication_route, 'oral'),
      v_med->>'instructions',
      NOW(),
      CASE
        WHEN (v_med->>'duration_days')::INTEGER > 0
        THEN NOW() + ((v_med->>'duration_days')::INTEGER || ' days')::INTERVAL
        ELSE NULL
      END,
      COALESCE((v_med->>'is_as_needed')::BOOLEAN, FALSE),
      'active',
      v_user_id
    )
    RETURNING id INTO v_rx_id;

    v_rx_ids := array_append(v_rx_ids, v_rx_id);

    -- Generar horario automáticamente si no es "según necesidad"
    IF NOT COALESCE((v_med->>'is_as_needed')::BOOLEAN, FALSE) THEN
      PERFORM generate_medication_schedule(v_rx_id);
    END IF;
  END LOOP;

  -- Crear exámenes
  FOR v_test IN SELECT * FROM jsonb_array_elements(p_tests)
  LOOP
    INSERT INTO medical_tests (
      tenant_id,
      family_id,
      family_member_id,
      medical_visit_id,
      medical_document_id,
      test_name,
      category,
      ordered_at,
      status,
      notes,
      created_by
    ) VALUES (
      v_doc.tenant_id,
      v_doc.family_id,
      v_doc.family_member_id,
      v_doc.medical_visit_id,
      p_document_id,
      v_test->>'test_name',
      v_test->>'category',
      NOW(),
      'pending',
      v_test->>'instructions',
      v_user_id
    )
    RETURNING id INTO v_test_id;

    v_test_ids := array_append(v_test_ids, v_test_id);
  END LOOP;

  -- Marcar documento como verificado
  UPDATE medical_documents
  SET
    processing_status = 'verified',
    verified_by_user  = TRUE,
    verified_at       = NOW(),
    updated_at        = NOW()
  WHERE id = p_document_id;

  PERFORM log_audit_event(
    v_doc.tenant_id, 'CONFIRM_DOCUMENT', 'medical_documents', p_document_id,
    jsonb_build_object(
      'medications_created', array_length(v_rx_ids, 1),
      'tests_created',       array_length(v_test_ids, 1)
    )
  );

  RETURN jsonb_build_object(
    'success',             TRUE,
    'prescription_ids',    v_rx_ids,
    'test_ids',            v_test_ids,
    'medications_created', array_length(v_rx_ids, 1),
    'tests_created',       array_length(v_test_ids, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
