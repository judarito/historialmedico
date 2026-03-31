-- ============================================================
-- 037 -- Permitir limpieza clinica desde SQL Editor
--
-- Ajusta la validacion de acceso para que la RPC funcione
-- tanto con JWT de usuario como desde contextos administrativos
-- del SQL Editor (donde auth.uid() viene NULL).
-- ============================================================

CREATE OR REPLACE FUNCTION public.clear_family_member_medical_data(
  p_family_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_member                     family_members%ROWTYPE;
  v_visit_ids                  UUID[] := ARRAY[]::UUID[];
  v_document_ids               UUID[] := ARRAY[]::UUID[];
  v_document_paths             TEXT[] := ARRAY[]::TEXT[];
  v_prescription_ids           UUID[] := ARRAY[]::UUID[];
  v_schedule_ids               UUID[] := ARRAY[]::UUID[];
  v_test_ids                   UUID[] := ARRAY[]::UUID[];
  v_reminder_ids               UUID[] := ARRAY[]::UUID[];
  v_deleted_notification_reads INTEGER := 0;
  v_deleted_reminders          INTEGER := 0;
  v_deleted_schedules          INTEGER := 0;
  v_deleted_prescriptions      INTEGER := 0;
  v_deleted_tests              INTEGER := 0;
  v_deleted_documents          INTEGER := 0;
  v_deleted_visits             INTEGER := 0;
  v_member_name                TEXT;
BEGIN
  SELECT *
  INTO v_member
  FROM family_members
  WHERE id = p_family_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Familiar no encontrado: %', p_family_member_id;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT user_belongs_to_tenant(v_member.tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  v_member_name := trim(concat_ws(' ', v_member.first_name, v_member.last_name));

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_visit_ids
  FROM medical_visits
  WHERE family_member_id = p_family_member_id;

  SELECT
    COALESCE(array_agg(id), ARRAY[]::UUID[]),
    COALESCE(array_agg(file_path) FILTER (WHERE file_path IS NOT NULL), ARRAY[]::TEXT[])
  INTO
    v_document_ids,
    v_document_paths
  FROM medical_documents
  WHERE family_member_id = p_family_member_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_prescription_ids
  FROM prescriptions
  WHERE family_member_id = p_family_member_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_schedule_ids
  FROM medication_schedules
  WHERE prescription_id = ANY(v_prescription_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_test_ids
  FROM medical_tests
  WHERE family_member_id = p_family_member_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
  INTO v_reminder_ids
  FROM reminders
  WHERE family_member_id = p_family_member_id
     OR medical_visit_id = ANY(v_visit_ids)
     OR prescription_id = ANY(v_prescription_ids)
     OR medication_schedule_id = ANY(v_schedule_ids)
     OR medical_test_id = ANY(v_test_ids);

  DELETE FROM notification_reads
  WHERE reminder_id = ANY(v_reminder_ids);
  GET DIAGNOSTICS v_deleted_notification_reads = ROW_COUNT;

  DELETE FROM reminders
  WHERE id = ANY(v_reminder_ids);
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
  WHERE id = ANY(v_visit_ids);
  GET DIAGNOSTICS v_deleted_visits = ROW_COUNT;

  PERFORM log_audit_event(
    v_member.tenant_id,
    'CLEAR_FAMILY_MEMBER_MEDICAL_DATA',
    'family_members',
    p_family_member_id,
    jsonb_build_object(
      'member_name', COALESCE(NULLIF(v_member_name, ''), 'Sin nombre'),
      'deleted_visits', v_deleted_visits,
      'deleted_documents', v_deleted_documents,
      'deleted_prescriptions', v_deleted_prescriptions,
      'deleted_schedules', v_deleted_schedules,
      'deleted_tests', v_deleted_tests,
      'deleted_reminders', v_deleted_reminders,
      'deleted_notification_reads', v_deleted_notification_reads,
      'file_paths', to_jsonb(v_document_paths)
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'family_member_id', p_family_member_id,
    'member_name', COALESCE(NULLIF(v_member_name, ''), 'Sin nombre'),
    'deleted_visits', v_deleted_visits,
    'deleted_documents', v_deleted_documents,
    'deleted_prescriptions', v_deleted_prescriptions,
    'deleted_schedules', v_deleted_schedules,
    'deleted_tests', v_deleted_tests,
    'deleted_reminders', v_deleted_reminders,
    'deleted_notification_reads', v_deleted_notification_reads,
    'file_paths', to_jsonb(v_document_paths)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.clear_family_member_medical_data(UUID) TO authenticated;
