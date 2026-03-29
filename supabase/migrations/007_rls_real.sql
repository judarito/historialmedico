-- ============================================================
-- Family Health Tracker — RLS y Policies (schema real)
-- Migration: 007_rls_real.sql
-- Usa nombres de columnas reales del schema existente
-- ============================================================

-- ============================================================
-- FUNCIONES HELPER MULTI-TENANT
-- ============================================================

-- Verifica si el usuario autenticado pertenece al tenant
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

-- Array de tenant_ids del usuario actual
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

-- Rol del usuario en un tenant
CREATE OR REPLACE FUNCTION public.my_role_in_tenant(p_tenant_id UUID)
RETURNS tenant_user_role AS $$
  SELECT role FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id   = auth.uid()
    AND is_active = TRUE
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Verifica si el usuario es admin u owner en el tenant
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
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE families             ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_visits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_tests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES: tenants
-- ============================================================
DROP POLICY IF EXISTS "tenants_select" ON tenants;
DROP POLICY IF EXISTS "tenants_insert" ON tenants;
DROP POLICY IF EXISTS "tenants_update" ON tenants;
DROP POLICY IF EXISTS "tenants_delete" ON tenants;

CREATE POLICY "tenants_select" ON tenants
  FOR SELECT TO authenticated
  USING (id = ANY(my_tenant_ids()));

CREATE POLICY "tenants_insert" ON tenants
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY "tenants_update" ON tenants
  FOR UPDATE TO authenticated
  USING (is_tenant_admin(id))
  WITH CHECK (is_tenant_admin(id));

CREATE POLICY "tenants_delete" ON tenants
  FOR DELETE TO authenticated
  USING (my_role_in_tenant(id) = 'owner');

-- ============================================================
-- POLICIES: profiles
-- tenant_id es NULL hasta que el usuario completa onboarding
-- ============================================================
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id IS NOT NULL AND user_belongs_to_tenant(tenant_id))
  );

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No se borra un profile directamente
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE TO authenticated
  USING (FALSE);

-- ============================================================
-- POLICIES: tenant_users
-- ============================================================
DROP POLICY IF EXISTS "tenant_users_select" ON tenant_users;
DROP POLICY IF EXISTS "tenant_users_insert" ON tenant_users;
DROP POLICY IF EXISTS "tenant_users_update" ON tenant_users;
DROP POLICY IF EXISTS "tenant_users_delete" ON tenant_users;

CREATE POLICY "tenant_users_select" ON tenant_users
  FOR SELECT TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "tenant_users_insert" ON tenant_users
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()           -- se agrega a sí mismo (onboarding)
    OR is_tenant_admin(tenant_id)  -- admin agrega a otro
  );

CREATE POLICY "tenant_users_update" ON tenant_users
  FOR UPDATE TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "tenant_users_delete" ON tenant_users
  FOR DELETE TO authenticated
  USING (my_role_in_tenant(tenant_id) = 'owner');

-- ============================================================
-- POLICIES: families
-- ============================================================
DROP POLICY IF EXISTS "families_select" ON families;
DROP POLICY IF EXISTS "families_insert" ON families;
DROP POLICY IF EXISTS "families_update" ON families;
DROP POLICY IF EXISTS "families_delete" ON families;

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
DROP POLICY IF EXISTS "family_members_select" ON family_members;
DROP POLICY IF EXISTS "family_members_insert" ON family_members;
DROP POLICY IF EXISTS "family_members_update" ON family_members;
DROP POLICY IF EXISTS "family_members_delete" ON family_members;

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
DROP POLICY IF EXISTS "medical_visits_select" ON medical_visits;
DROP POLICY IF EXISTS "medical_visits_insert" ON medical_visits;
DROP POLICY IF EXISTS "medical_visits_update" ON medical_visits;
DROP POLICY IF EXISTS "medical_visits_delete" ON medical_visits;

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
DROP POLICY IF EXISTS "medical_documents_select" ON medical_documents;
DROP POLICY IF EXISTS "medical_documents_insert" ON medical_documents;
DROP POLICY IF EXISTS "medical_documents_update" ON medical_documents;
DROP POLICY IF EXISTS "medical_documents_delete" ON medical_documents;

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
-- (tabla de medicamentos individuales, ligados a medical_documents)
-- ============================================================
DROP POLICY IF EXISTS "prescriptions_select" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_insert" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_update" ON prescriptions;
DROP POLICY IF EXISTS "prescriptions_delete" ON prescriptions;

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
-- POLICIES: medication_schedules
-- Cualquier miembro del tenant puede marcar dosis
-- ============================================================
DROP POLICY IF EXISTS "medication_schedules_select" ON medication_schedules;
DROP POLICY IF EXISTS "medication_schedules_insert" ON medication_schedules;
DROP POLICY IF EXISTS "medication_schedules_update" ON medication_schedules;
DROP POLICY IF EXISTS "medication_schedules_delete" ON medication_schedules;

CREATE POLICY "medication_schedules_select" ON medication_schedules
  FOR SELECT TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medication_schedules_insert" ON medication_schedules
  FOR INSERT TO authenticated
  WITH CHECK (user_belongs_to_tenant(tenant_id));

-- UPDATE: cualquier miembro puede marcar dosis (taken_at, status)
CREATE POLICY "medication_schedules_update" ON medication_schedules
  FOR UPDATE TO authenticated
  USING (user_belongs_to_tenant(tenant_id))
  WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medication_schedules_delete" ON medication_schedules
  FOR DELETE TO authenticated
  USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: medical_tests
-- ============================================================
DROP POLICY IF EXISTS "medical_tests_select" ON medical_tests;
DROP POLICY IF EXISTS "medical_tests_insert" ON medical_tests;
DROP POLICY IF EXISTS "medical_tests_update" ON medical_tests;
DROP POLICY IF EXISTS "medical_tests_delete" ON medical_tests;

CREATE POLICY "medical_tests_select" ON medical_tests
  FOR SELECT TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_tests_insert" ON medical_tests
  FOR INSERT TO authenticated
  WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_tests_update" ON medical_tests
  FOR UPDATE TO authenticated
  USING (user_belongs_to_tenant(tenant_id))
  WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "medical_tests_delete" ON medical_tests
  FOR DELETE TO authenticated
  USING (is_tenant_admin(tenant_id));

-- ============================================================
-- POLICIES: reminders
-- Cada usuario solo ve sus propios recordatorios
-- (no hay user_id directo — se filtra por family_member via tenant)
-- ============================================================
DROP POLICY IF EXISTS "reminders_select" ON reminders;
DROP POLICY IF EXISTS "reminders_insert" ON reminders;
DROP POLICY IF EXISTS "reminders_update" ON reminders;
DROP POLICY IF EXISTS "reminders_delete" ON reminders;

CREATE POLICY "reminders_select" ON reminders
  FOR SELECT TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "reminders_insert" ON reminders
  FOR INSERT TO authenticated
  WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "reminders_update" ON reminders
  FOR UPDATE TO authenticated
  USING (user_belongs_to_tenant(tenant_id))
  WITH CHECK (user_belongs_to_tenant(tenant_id));

CREATE POLICY "reminders_delete" ON reminders
  FOR DELETE TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

-- ============================================================
-- POLICIES: audit_logs
-- Solo admins pueden leer. Nadie puede modificar.
-- Escritura solo via función SECURITY DEFINER.
-- ============================================================
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_update" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete" ON audit_logs;

CREATE POLICY "audit_logs_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (is_tenant_admin(tenant_id));

-- Solo service_role / funciones SECURITY DEFINER pueden insertar
CREATE POLICY "audit_logs_insert" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (FALSE);

CREATE POLICY "audit_logs_update" ON audit_logs
  FOR UPDATE TO authenticated
  USING (FALSE);

CREATE POLICY "audit_logs_delete" ON audit_logs
  FOR DELETE TO authenticated
  USING (FALSE);

-- ============================================================
-- FUNCIÓN DE AUDITORÍA
-- Usa entity_name / entity_id / details (columnas reales del schema)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_tenant_id   UUID,
  p_action      TEXT,
  p_entity_name TEXT,
  p_entity_id   UUID   DEFAULT NULL,
  p_details     JSONB  DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, details)
  VALUES (p_tenant_id, auth.uid(), p_action, p_entity_name, p_entity_id, p_details);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- TRIGGER: crear profile al registrar nuevo usuario
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
