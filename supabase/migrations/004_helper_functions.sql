-- ============================================================
-- Family Health Tracker — Funciones Helper y RPCs
-- Migration: 004_helper_functions.sql
-- ============================================================

-- ============================================================
-- RPC: create_tenant_with_owner
-- Crea un tenant y agrega al usuario como owner en una transacción
-- Evita estado inconsistente (tenant sin owner)
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
    -- Verificar que el usuario está autenticado
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- Verificar slug único
    IF EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug) THEN
        RAISE EXCEPTION 'El slug "%" ya está en uso', p_slug;
    END IF;

    -- Crear el tenant
    INSERT INTO tenants (name, slug)
    VALUES (p_name, p_slug)
    RETURNING id INTO v_tenant_id;

    -- Agregar al usuario como owner
    INSERT INTO tenant_users (tenant_id, user_id, role, joined_at)
    VALUES (v_tenant_id, v_user_id, 'owner', NOW());

    -- Actualizar el profile con el tenant_id
    UPDATE profiles SET tenant_id = v_tenant_id WHERE id = v_user_id;

    -- Audit log
    PERFORM log_audit_event(v_tenant_id, 'CREATE_TENANT', 'tenants', v_tenant_id,
        NULL, jsonb_build_object('name', p_name, 'slug', p_slug));

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'success', TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: generate_medication_schedule
-- Genera horarios de dosis para un medicamento
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_medication_schedule(
    p_medication_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_med           RECORD;
    v_current_time  TIMESTAMPTZ;
    v_end_time      TIMESTAMPTZ;
    v_interval      INTERVAL;
    v_dose_number   INTEGER := 1;
    v_count         INTEGER := 0;
    v_tenant_id     UUID;
BEGIN
    -- Obtener datos del medicamento
    SELECT pm.*, fm.tenant_id INTO v_med
    FROM prescription_medications pm
    JOIN family_members fm ON fm.id = pm.family_member_id
    WHERE pm.id = p_medication_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Medicamento no encontrado';
    END IF;

    -- Verificar pertenencia al tenant
    IF NOT user_belongs_to_tenant(v_med.tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Si es "según necesidad" no se genera horario automático
    IF v_med.is_as_needed THEN
        RETURN 0;
    END IF;

    -- Calcular el intervalo entre dosis
    IF v_med.interval_hours IS NOT NULL AND v_med.interval_hours > 0 THEN
        v_interval := (v_med.interval_hours || ' hours')::INTERVAL;
    ELSE
        -- Fallback según frecuencia
        v_interval := CASE v_med.frequency
            WHEN 'twice_daily'   THEN '12 hours'::INTERVAL
            WHEN 'three_daily'   THEN '8 hours'::INTERVAL
            WHEN 'four_daily'    THEN '6 hours'::INTERVAL
            WHEN 'every_6h'      THEN '6 hours'::INTERVAL
            WHEN 'every_8h'      THEN '8 hours'::INTERVAL
            WHEN 'every_12h'     THEN '12 hours'::INTERVAL
            WHEN 'every_24h'     THEN '24 hours'::INTERVAL
            WHEN 'weekly'        THEN '168 hours'::INTERVAL
            ELSE '24 hours'::INTERVAL
        END;
    END IF;

    -- Fecha de inicio (si no tiene, usar ahora)
    v_current_time := COALESCE(
        (v_med.start_date::TEXT || ' 08:00:00')::TIMESTAMPTZ,
        NOW()
    );

    -- Fecha de fin
    IF v_med.duration_days IS NOT NULL AND v_med.duration_days > 0 THEN
        v_end_time := v_current_time + (v_med.duration_days || ' days')::INTERVAL;
    ELSE
        -- Sin duración definida: generar para 30 días
        v_end_time := v_current_time + '30 days'::INTERVAL;
    END IF;

    -- Eliminar horarios pendientes previos del mismo medicamento
    DELETE FROM medication_schedules
    WHERE medication_id = p_medication_id AND status = 'pending';

    -- Generar las dosis
    WHILE v_current_time <= v_end_time LOOP
        INSERT INTO medication_schedules (
            tenant_id,
            medication_id,
            family_member_id,
            scheduled_at,
            dose_number,
            dose_label,
            status
        ) VALUES (
            v_med.tenant_id,
            p_medication_id,
            v_med.family_member_id,
            v_current_time,
            v_dose_number,
            'Dosis ' || v_dose_number,
            'pending'
        );

        v_current_time := v_current_time + v_interval;
        v_dose_number  := v_dose_number + 1;
        v_count        := v_count + 1;

        -- Límite de seguridad: máximo 500 dosis por medicamento
        IF v_count >= 500 THEN
            EXIT;
        END IF;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: mark_dose
-- Marca una dosis como tomada, omitida o tardía
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_dose(
    p_schedule_id UUID,
    p_status      dose_status,
    p_notes       TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_schedule RECORD;
BEGIN
    SELECT ms.*, fm.tenant_id INTO v_schedule
    FROM medication_schedules ms
    JOIN family_members fm ON fm.id = ms.family_member_id
    WHERE ms.id = p_schedule_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Horario de dosis no encontrado';
    END IF;

    IF NOT user_belongs_to_tenant(v_schedule.tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    UPDATE medication_schedules
    SET
        status   = p_status,
        taken_at = CASE WHEN p_status IN ('taken', 'late') THEN NOW() ELSE NULL END,
        taken_by = CASE WHEN p_status IN ('taken', 'late') THEN auth.uid() ELSE NULL END,
        notes    = COALESCE(p_notes, notes)
    WHERE id = p_schedule_id;

    -- Log de auditoría
    PERFORM log_audit_event(
        v_schedule.tenant_id,
        'MARK_DOSE_' || UPPER(p_status::TEXT),
        'medication_schedules',
        p_schedule_id,
        NULL,
        jsonb_build_object('status', p_status, 'taken_at', NOW())
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: get_pending_doses_today
-- Retorna las dosis pendientes del día para un familiar
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pending_doses_today(
    p_family_member_id UUID
)
RETURNS TABLE (
    schedule_id     UUID,
    medication_name TEXT,
    dose_amount     NUMERIC,
    dose_unit       TEXT,
    route           medication_route,
    scheduled_at    TIMESTAMPTZ,
    dose_label      TEXT,
    status          dose_status
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
        pm.name,
        pm.dose_amount,
        pm.dose_unit,
        pm.route,
        ms.scheduled_at,
        ms.dose_label,
        ms.status
    FROM medication_schedules ms
    JOIN prescription_medications pm ON pm.id = ms.medication_id
    WHERE ms.family_member_id = p_family_member_id
      AND ms.scheduled_at >= NOW()::DATE
      AND ms.scheduled_at <  NOW()::DATE + '1 day'::INTERVAL
      AND ms.status = 'pending'
    ORDER BY ms.scheduled_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: search_medical_history
-- Búsqueda global en historial médico de un familiar
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_medical_history(
    p_family_member_id UUID,
    p_query            TEXT
)
RETURNS TABLE (
    result_type     TEXT,
    result_id       UUID,
    title           TEXT,
    subtitle        TEXT,
    date_ref        DATE,
    relevance       REAL
) AS $$
DECLARE
    v_tenant_id UUID;
    v_tsquery   TSQUERY;
BEGIN
    SELECT fm.tenant_id INTO v_tenant_id
    FROM family_members fm WHERE fm.id = p_family_member_id;

    IF NOT user_belongs_to_tenant(v_tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Preparar query con soporte para búsqueda parcial
    v_tsquery := plainto_tsquery('spanish', p_query);

    RETURN QUERY
    -- Buscar en visitas médicas
    SELECT
        'visit'::TEXT,
        mv.id,
        COALESCE(mv.diagnosis, mv.reason) AS title,
        COALESCE(mv.doctor_name, mv.institution) AS subtitle,
        mv.visit_date,
        ts_rank(mv.search_vector, v_tsquery)
    FROM medical_visits mv
    WHERE mv.family_member_id = p_family_member_id
      AND mv.search_vector @@ v_tsquery

    UNION ALL

    -- Buscar en medicamentos
    SELECT
        'medication'::TEXT,
        pm.id,
        pm.name AS title,
        pm.presentation AS subtitle,
        pm.start_date,
        similarity(pm.name, p_query)
    FROM prescription_medications pm
    WHERE pm.family_member_id = p_family_member_id
      AND pm.name ILIKE '%' || p_query || '%'

    UNION ALL

    -- Buscar en exámenes
    SELECT
        'test'::TEXT,
        pt.id,
        pt.name AS title,
        pt.category AS subtitle,
        pt.completed_date,
        similarity(pt.name, p_query)
    FROM prescription_tests pt
    WHERE pt.family_member_id = p_family_member_id
      AND pt.name ILIKE '%' || p_query || '%'

    ORDER BY relevance DESC
    LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- RPC: get_pending_tests
-- Exámenes pendientes de un familiar
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pending_tests(
    p_family_member_id UUID
)
RETURNS TABLE (
    test_id      UUID,
    name         TEXT,
    category     TEXT,
    status       test_status,
    ordered_from TEXT,
    ordered_date DATE
) AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    SELECT fm.tenant_id INTO v_tenant_id
    FROM family_members fm WHERE fm.id = p_family_member_id;

    IF NOT user_belongs_to_tenant(v_tenant_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT
        pt.id,
        pt.name,
        pt.category,
        pt.status,
        p.diagnosis AS ordered_from,
        p.prescription_date
    FROM prescription_tests pt
    JOIN prescriptions p ON p.id = pt.prescription_id
    WHERE pt.family_member_id = p_family_member_id
      AND pt.status IN ('ordered', 'scheduled')
    ORDER BY p.prescription_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
