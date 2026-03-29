-- ============================================================
-- Family Health Tracker — RLS y Policies
-- Migration: 002_rls_policies.sql
-- TODAS las tablas tienen RLS habilitado y policies completas
-- ============================================================

-- ============================================================
-- FUNCIÓN HELPER: user_belongs_to_tenant
-- Verifica si el usuario autenticado pertenece al tenant
-- SECURITY DEFINER: necesario para acceder a tenant_users
-- sin exponer la tabla directamente. Riesgo mitigado: la función
-- solo lee y no expone datos cruzados entre tenants.
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_belongs_to_tenant(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = p_tenant_id
          AND user_id   = auth.uid()
          AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Función que retorna los tenant_ids del usuario actual
CREATE OR REPLACE FUNCTION public.my_tenant_ids()
RETURNS UUID[] AS $$
BEGIN
    RETURN ARRAY(
        SELECT tenant_id FROM tenant_users
        WHERE user_id   = auth.uid()
          AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Función que retorna el rol del usuario en un tenant
CREATE OR REPLACE FUNCTION public.my_role_in_tenant(p_tenant_id UUID)
RETURNS tenant_user_role AS $$
    SELECT role FROM tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id   = auth.uid()
      AND is_active = TRUE
    LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Función para verificar si el usuario es admin o owner
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = p_tenant_id
          AND user_id   = auth.uid()
          AND role      IN ('owner', 'admin')
          AND is_active = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE tenants                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE families                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_visits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_medications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_tests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES: tenants
-- ============================================================
-- SELECT: solo los tenants a los que pertenece el usuario
CREATE POLICY "tenants_select" ON tenants
    FOR SELECT TO authenticated
    USING (id = ANY(my_tenant_ids()));

-- INSERT: cualquier usuario autenticado puede crear un tenant
-- (se crea su relación en tenant_users inmediatamente en la misma transacción)
CREATE POLICY "tenants_insert" ON tenants
    FOR INSERT TO authenticated
    WITH CHECK (TRUE);

-- UPDATE: solo owner o admin del tenant
CREATE POLICY "tenants_update" ON tenants
    FOR UPDATE TO authenticated
    USING (is_tenant_admin(id))
    WITH CHECK (is_tenant_admin(id));

-- DELETE: solo el owner del tenant
CREATE POLICY "tenants_delete" ON tenants
    FOR DELETE TO authenticated
    USING (my_role_in_tenant(id) = 'owner');

-- ============================================================
-- POLICIES: profiles
-- ============================================================
-- SELECT: propio perfil O perfiles de miembros del mismo tenant
CREATE POLICY "profiles_select" ON profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid()
        OR tenant_id = ANY(my_tenant_ids())
    );

-- INSERT: solo puede insertar su propio perfil (o el trigger de sistema)
CREATE POLICY "profiles_insert" ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid());

-- UPDATE: solo puede actualizar su propio perfil
CREATE POLICY "profiles_update" ON profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- DELETE: no se permite borrar perfiles directamente
CREATE POLICY "profiles_delete" ON profiles
    FOR DELETE TO authenticated
    USING (FALSE);

-- ============================================================
-- POLICIES: tenant_users
-- ============================================================
-- SELECT: ver usuarios del mismo tenant
CREATE POLICY "tenant_users_select" ON tenant_users
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

-- INSERT: solo owner o admin puede agregar usuarios al tenant
CREATE POLICY "tenant_users_insert" ON tenant_users
    FOR INSERT TO authenticated
    WITH CHECK (
        -- caso 1: el owner se agrega a sí mismo al crear el tenant
        user_id = auth.uid()
        -- caso 2: admin agrega a otro usuario
        OR is_tenant_admin(tenant_id)
    );

-- UPDATE: solo admin puede cambiar roles
CREATE POLICY "tenant_users_update" ON tenant_users
    FOR UPDATE TO authenticated
    USING (is_tenant_admin(tenant_id))
    WITH CHECK (is_tenant_admin(tenant_id));

-- DELETE: solo owner puede eliminar usuarios del tenant
CREATE POLICY "tenant_users_delete" ON tenant_users
    FOR DELETE TO authenticated
    USING (my_role_in_tenant(tenant_id) = 'owner');

-- ============================================================
-- POLICIES: families
-- ============================================================
CREATE POLICY "families_select" ON families
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "families_insert" ON families
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "families_update" ON families
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "families_delete" ON families
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: family_members
-- ============================================================
CREATE POLICY "family_members_select" ON family_members
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "family_members_insert" ON family_members
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "family_members_update" ON family_members
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "family_members_delete" ON family_members
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: medical_visits
-- ============================================================
CREATE POLICY "medical_visits_select" ON medical_visits
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_visits_insert" ON medical_visits
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_visits_update" ON medical_visits
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_visits_delete" ON medical_visits
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: medical_documents
-- ============================================================
CREATE POLICY "medical_documents_select" ON medical_documents
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_documents_insert" ON medical_documents
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_documents_update" ON medical_documents
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_documents_delete" ON medical_documents
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: prescriptions
-- ============================================================
CREATE POLICY "prescriptions_select" ON prescriptions
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescriptions_insert" ON prescriptions
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescriptions_update" ON prescriptions
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescriptions_delete" ON prescriptions
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: prescription_medications
-- ============================================================
CREATE POLICY "prescription_medications_select" ON prescription_medications
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_medications_insert" ON prescription_medications
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_medications_update" ON prescription_medications
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_medications_delete" ON prescription_medications
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: medication_schedules
-- ============================================================
CREATE POLICY "medication_schedules_select" ON medication_schedules
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medication_schedules_insert" ON medication_schedules
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

-- UPDATE especial: cualquier miembro puede marcar dosis (taken_at, status)
-- pero solo admins pueden modificar el schedule completo
CREATE POLICY "medication_schedules_update" ON medication_schedules
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medication_schedules_delete" ON medication_schedules
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: prescription_tests
-- ============================================================
CREATE POLICY "prescription_tests_select" ON prescription_tests
    FOR SELECT TO authenticated
    USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_tests_insert" ON prescription_tests
    FOR INSERT TO authenticated
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_tests_update" ON prescription_tests
    FOR UPDATE TO authenticated
    USING (user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "prescription_tests_delete" ON prescription_tests
    FOR DELETE TO authenticated
    USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: reminders
-- ============================================================
-- SELECT: solo ve sus propios recordatorios
CREATE POLICY "reminders_select" ON reminders
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND user_belongs_to_tenant(tenant_id)
    );

-- INSERT: puede crear recordatorios para sí mismo dentro del tenant
CREATE POLICY "reminders_insert" ON reminders
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND user_belongs_to_tenant(tenant_id)
    );

CREATE POLICY "reminders_update" ON reminders
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND user_belongs_to_tenant(tenant_id))
    WITH CHECK (user_id = auth.uid() AND user_belongs_to_tenant(tenant_id));

CREATE POLICY "reminders_delete" ON reminders
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND user_belongs_to_tenant(tenant_id));

-- ============================================================
-- POLICIES: audit_logs
-- ============================================================
-- SELECT: solo admins pueden ver logs del tenant
CREATE POLICY "audit_logs_select" ON audit_logs
    FOR SELECT TO authenticated
    USING (is_tenant_admin(tenant_id));

-- INSERT: solo el sistema (service_role) y la Edge Function puede insertar
-- Los usuarios autenticados NO pueden insertar directamente
CREATE POLICY "audit_logs_insert" ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (FALSE);   -- solo service_role o SECURITY DEFINER functions

-- UPDATE: nadie puede modificar logs
CREATE POLICY "audit_logs_update" ON audit_logs
    FOR UPDATE TO authenticated
    USING (FALSE);

-- DELETE: nadie puede borrar logs
CREATE POLICY "audit_logs_delete" ON audit_logs
    FOR DELETE TO authenticated
    USING (FALSE);

-- ============================================================
-- FUNCIÓN DE AUDITORÍA (llamada por Edge Functions o triggers)
-- Usa SECURITY DEFINER para poder escribir en audit_logs
-- sin que el usuario tenga permiso directo de INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_tenant_id   UUID,
    p_action      TEXT,
    p_table_name  TEXT,
    p_record_id   UUID DEFAULT NULL,
    p_old_data    JSONB DEFAULT NULL,
    p_new_data    JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (p_tenant_id, auth.uid(), p_action, p_table_name, p_record_id, p_old_data, p_new_data);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
