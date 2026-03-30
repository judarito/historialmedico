-- ============================================================
-- 015 — confirm_document_and_create_records con soporte histórico
--
-- Cambios respecto a 008:
--   - Lee la fecha de la visita vinculada al documento
--   - Si la visita es histórica (visit_date < hoy):
--       · prescriptions.start_at = visit_date (no NOW())
--       · prescriptions.end_at   = visit_date + duration_days
--       · prescriptions.status   = 'completed' si el tratamiento ya terminó
--                                = 'active' si sigue vigente o sin fecha fin
--       · NO genera medication_schedule para tratamientos ya terminados
--       · medical_tests.ordered_at = visit_date
--       · medical_tests.status     = 'completed'
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_document_and_create_records(
  p_document_id      UUID,
  p_medications      JSONB,
  p_tests            JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_doc           RECORD;
  v_visit_date    TIMESTAMPTZ;
  v_is_historical BOOLEAN;
  v_start_at      TIMESTAMPTZ;
  v_user_id       UUID := auth.uid();
  v_med           JSONB;
  v_test          JSONB;
  v_rx_id         UUID;
  v_test_id       UUID;
  v_rx_ids        UUID[] := '{}';
  v_test_ids      UUID[] := '{}';
  v_end_at        TIMESTAMPTZ;
  v_rx_status     TEXT;
  v_test_status   TEXT;
  v_duration_days INTEGER;
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

  -- Leer la fecha de la visita vinculada
  SELECT mv.visit_date INTO v_visit_date
  FROM medical_visits mv
  WHERE mv.id = v_doc.medical_visit_id;

  -- Determinar si es una visita histórica (más de 1 día antes de hoy)
  v_is_historical := v_visit_date IS NOT NULL AND v_visit_date < (NOW() - INTERVAL '7 days');
  v_start_at      := COALESCE(v_visit_date, NOW());

  -- Estado de exámenes según antigüedad de la visita
  v_test_status := CASE WHEN v_is_historical THEN 'completed' ELSE 'pending' END;

  -- ── Crear prescripciones ──────────────────────────────────────────────────
  FOR v_med IN SELECT * FROM jsonb_array_elements(p_medications)
  LOOP
    v_duration_days := (v_med->>'duration_days')::INTEGER;

    -- Fecha de fin: desde la fecha de la visita (no desde hoy)
    v_end_at := CASE
      WHEN v_duration_days IS NOT NULL AND v_duration_days > 0
      THEN v_start_at + (v_duration_days || ' days')::INTERVAL
      ELSE NULL
    END;

    -- Estado del medicamento:
    --   · histórico + tratamiento terminado → 'completed'
    --   · histórico + sin fecha fin (crónico) → 'active'
    --   · histórico + todavía vigente → 'active'
    --   · reciente → 'active'
    v_rx_status := CASE
      WHEN v_is_historical AND v_end_at IS NOT NULL AND v_end_at < NOW() THEN 'completed'
      ELSE 'active'
    END;

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
      v_duration_days,
      COALESCE((v_med->>'route')::medication_route, 'oral'),
      v_med->>'instructions',
      v_start_at,
      v_end_at,
      COALESCE((v_med->>'is_as_needed')::BOOLEAN, FALSE),
      v_rx_status,
      v_user_id
    )
    RETURNING id INTO v_rx_id;

    v_rx_ids := array_append(v_rx_ids, v_rx_id);

    -- Generar horario solo si el medicamento está activo y no es "según necesidad"
    IF v_rx_status = 'active' AND NOT COALESCE((v_med->>'is_as_needed')::BOOLEAN, FALSE) THEN
      PERFORM generate_medication_schedule(v_rx_id);
    END IF;
  END LOOP;

  -- ── Crear exámenes ────────────────────────────────────────────────────────
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
      v_start_at,
      v_test_status,
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
      'tests_created',       array_length(v_test_ids, 1),
      'is_historical',       v_is_historical,
      'visit_date',          v_visit_date
    )
  );

  RETURN jsonb_build_object(
    'success',             TRUE,
    'prescription_ids',    v_rx_ids,
    'test_ids',            v_test_ids,
    'medications_created', array_length(v_rx_ids, 1),
    'tests_created',       array_length(v_test_ids, 1),
    'is_historical',       v_is_historical
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
