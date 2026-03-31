-- ============================================================
-- 030 -- Borrado profundo de adjuntos y visitas
--
-- 1. Permite borrar un adjunto junto con todos sus datos derivados.
-- 2. Permite eliminar una visita por completo con adjuntos,
--    medicamentos, examenes, horarios y recordatorios asociados.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_medical_document_with_dependencies(
  p_document_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_doc                    medical_documents%ROWTYPE;
  v_prescription_ids       UUID[] := ARRAY[]::UUID[];
  v_schedule_ids           UUID[] := ARRAY[]::UUID[];
  v_test_ids               UUID[] := ARRAY[]::UUID[];
  v_deleted_reminders      INTEGER := 0;
  v_deleted_schedules      INTEGER := 0;
  v_deleted_prescriptions  INTEGER := 0;
  v_deleted_tests          INTEGER := 0;
BEGIN
  SELECT *
  INTO v_doc
  FROM medical_documents
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjunto no encontrado: %', p_document_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_doc.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_prescription_ids
  FROM prescriptions
  WHERE medical_document_id = p_document_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_schedule_ids
  FROM medication_schedules
  WHERE prescription_id = ANY(v_prescription_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_test_ids
  FROM medical_tests
  WHERE medical_document_id = p_document_id
     OR result_document_id = p_document_id;

  DELETE FROM reminders
  WHERE prescription_id = ANY(v_prescription_ids)
     OR medication_schedule_id = ANY(v_schedule_ids)
     OR medical_test_id = ANY(v_test_ids);
  GET DIAGNOSTICS v_deleted_reminders = ROW_COUNT;

  DELETE FROM medication_schedules
  WHERE id = ANY(v_schedule_ids);
  GET DIAGNOSTICS v_deleted_schedules = ROW_COUNT;

  DELETE FROM prescriptions
  WHERE id = ANY(v_prescription_ids);
  GET DIAGNOSTICS v_deleted_prescriptions = ROW_COUNT;

  DELETE FROM medical_tests
  WHERE id = ANY(v_test_ids);
  GET DIAGNOSTICS v_deleted_tests = ROW_COUNT;

  DELETE FROM medical_documents
  WHERE id = p_document_id;

  PERFORM log_audit_event(
    v_doc.tenant_id,
    'DELETE_MEDICAL_DOCUMENT_WITH_DEPENDENCIES',
    'medical_documents',
    p_document_id,
    jsonb_build_object(
      'document_type', v_doc.document_type,
      'medical_visit_id', v_doc.medical_visit_id,
      'file_path', v_doc.file_path,
      'deleted_prescriptions', v_deleted_prescriptions,
      'deleted_schedules', v_deleted_schedules,
      'deleted_tests', v_deleted_tests,
      'deleted_reminders', v_deleted_reminders
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'document_id', p_document_id,
    'medical_visit_id', v_doc.medical_visit_id,
    'file_paths', jsonb_build_array(v_doc.file_path),
    'deleted_prescriptions', v_deleted_prescriptions,
    'deleted_schedules', v_deleted_schedules,
    'deleted_tests', v_deleted_tests,
    'deleted_reminders', v_deleted_reminders
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_medical_visit_cascade(
  p_visit_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_visit                    medical_visits%ROWTYPE;
  v_document_ids             UUID[] := ARRAY[]::UUID[];
  v_document_paths           TEXT[] := ARRAY[]::TEXT[];
  v_prescription_ids         UUID[] := ARRAY[]::UUID[];
  v_schedule_ids             UUID[] := ARRAY[]::UUID[];
  v_test_ids                 UUID[] := ARRAY[]::UUID[];
  v_deleted_documents        INTEGER := 0;
  v_deleted_prescriptions    INTEGER := 0;
  v_deleted_schedules        INTEGER := 0;
  v_deleted_tests            INTEGER := 0;
  v_deleted_reminders        INTEGER := 0;
BEGIN
  SELECT *
  INTO v_visit
  FROM medical_visits
  WHERE id = p_visit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visita no encontrada: %', p_visit_id;
  END IF;

  IF NOT user_belongs_to_tenant(v_visit.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  SELECT
    COALESCE(array_agg(id), ARRAY[]::UUID[]),
    COALESCE(array_agg(file_path) FILTER (WHERE file_path IS NOT NULL), ARRAY[]::TEXT[])
  INTO
    v_document_ids,
    v_document_paths
  FROM medical_documents
  WHERE medical_visit_id = p_visit_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_prescription_ids
  FROM prescriptions
  WHERE medical_visit_id = p_visit_id
     OR medical_document_id = ANY(v_document_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_schedule_ids
  FROM medication_schedules
  WHERE prescription_id = ANY(v_prescription_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_test_ids
  FROM medical_tests
  WHERE medical_visit_id = p_visit_id
     OR medical_document_id = ANY(v_document_ids)
     OR result_document_id = ANY(v_document_ids);

  DELETE FROM reminders
  WHERE medical_visit_id = p_visit_id
     OR prescription_id = ANY(v_prescription_ids)
     OR medication_schedule_id = ANY(v_schedule_ids)
     OR medical_test_id = ANY(v_test_ids);
  GET DIAGNOSTICS v_deleted_reminders = ROW_COUNT;

  DELETE FROM medication_schedules
  WHERE id = ANY(v_schedule_ids);
  GET DIAGNOSTICS v_deleted_schedules = ROW_COUNT;

  DELETE FROM prescriptions
  WHERE id = ANY(v_prescription_ids);
  GET DIAGNOSTICS v_deleted_prescriptions = ROW_COUNT;

  DELETE FROM medical_tests
  WHERE id = ANY(v_test_ids);
  GET DIAGNOSTICS v_deleted_tests = ROW_COUNT;

  DELETE FROM medical_documents
  WHERE id = ANY(v_document_ids);
  GET DIAGNOSTICS v_deleted_documents = ROW_COUNT;

  DELETE FROM medical_visits
  WHERE id = p_visit_id;

  PERFORM log_audit_event(
    v_visit.tenant_id,
    'DELETE_MEDICAL_VISIT_CASCADE',
    'medical_visits',
    p_visit_id,
    jsonb_build_object(
      'deleted_documents', v_deleted_documents,
      'deleted_prescriptions', v_deleted_prescriptions,
      'deleted_schedules', v_deleted_schedules,
      'deleted_tests', v_deleted_tests,
      'deleted_reminders', v_deleted_reminders,
      'file_paths', to_jsonb(v_document_paths)
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'visit_id', p_visit_id,
    'file_paths', to_jsonb(v_document_paths),
    'deleted_documents', v_deleted_documents,
    'deleted_prescriptions', v_deleted_prescriptions,
    'deleted_schedules', v_deleted_schedules,
    'deleted_tests', v_deleted_tests,
    'deleted_reminders', v_deleted_reminders
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.delete_medical_document_with_dependencies(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_medical_visit_cascade(UUID) TO authenticated;
