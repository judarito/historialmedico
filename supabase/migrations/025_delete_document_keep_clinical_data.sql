-- ============================================================
-- 025 — Permitir borrar adjuntos conservando datos clinicos
--
-- El archivo original puede eliminarse aunque ya haya generado
-- medicamentos o examenes. Los registros clinicos se preservan
-- y solo se desvinculan del documento borrado.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_medical_document_attachment(
  p_document_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_doc                    medical_documents%ROWTYPE;
  v_detached_prescriptions INTEGER := 0;
  v_detached_tests         INTEGER := 0;
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

  WITH detached_prescriptions AS (
    UPDATE prescriptions
    SET
      medical_document_id = NULL,
      updated_at = NOW()
    WHERE medical_document_id = p_document_id
    RETURNING id
  )
  SELECT COUNT(*)
  INTO v_detached_prescriptions
  FROM detached_prescriptions;

  WITH detached_tests AS (
    UPDATE medical_tests
    SET
      medical_document_id = CASE WHEN medical_document_id = p_document_id THEN NULL ELSE medical_document_id END,
      result_document_id = CASE WHEN result_document_id = p_document_id THEN NULL ELSE result_document_id END,
      updated_at = NOW()
    WHERE medical_document_id = p_document_id
       OR result_document_id = p_document_id
    RETURNING id
  )
  SELECT COUNT(*)
  INTO v_detached_tests
  FROM detached_tests;

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
      'file_path', v_doc.file_path,
      'detached_prescriptions', v_detached_prescriptions,
      'detached_tests', v_detached_tests
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'document_id', p_document_id,
    'file_path', v_doc.file_path,
    'medical_visit_id', v_doc.medical_visit_id,
    'document_type', v_doc.document_type,
    'detached_prescriptions', v_detached_prescriptions,
    'detached_tests', v_detached_tests,
    'preserved_clinical_data', (v_detached_prescriptions > 0 OR v_detached_tests > 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
