-- ============================================================
-- Family Health Tracker — Adaptar schema existente
-- Migration: 006_adapt_schema.sql
-- Solo agrega columnas faltantes. No modifica ni elimina nada.
-- ============================================================

-- Extensiones primero: deben existir antes de crear índices que las usen
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================
-- profiles: agregar tenant_id, push_token, avatar_url, locale
-- tenant_id es crítico para multi-tenant en RLS
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS locale     TEXT DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS push_token TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON profiles(tenant_id);

-- ============================================================
-- tenant_users: agregar invited_by y joined_at
-- ============================================================
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS joined_at  TIMESTAMPTZ;

-- ============================================================
-- families: agregar avatar_url
-- ============================================================
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ============================================================
-- medication_schedules: agregar dose_number y dose_label
-- Útiles para mostrar "Dosis 3 de 14" en la UI
-- ============================================================
ALTER TABLE medication_schedules
  ADD COLUMN IF NOT EXISTS dose_number INTEGER,
  ADD COLUMN IF NOT EXISTS dose_label  TEXT;

-- ============================================================
-- reminders: agregar push_receipt
-- Guarda la respuesta de Expo para rastreo de entrega
-- ============================================================
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS push_receipt JSONB;

-- ============================================================
-- Índices adicionales para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_families_tenant_id
  ON families(tenant_id);

CREATE INDEX IF NOT EXISTS idx_family_members_tenant_id
  ON family_members(tenant_id);

CREATE INDEX IF NOT EXISTS idx_family_members_family_id
  ON family_members(family_id);

CREATE INDEX IF NOT EXISTS idx_medical_visits_tenant_id
  ON medical_visits(tenant_id);

CREATE INDEX IF NOT EXISTS idx_medical_visits_family_member_id
  ON medical_visits(family_member_id);

CREATE INDEX IF NOT EXISTS idx_medical_visits_visit_date
  ON medical_visits(visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_medical_documents_tenant_id
  ON medical_documents(tenant_id);

CREATE INDEX IF NOT EXISTS idx_medical_documents_family_member_id
  ON medical_documents(family_member_id);

CREATE INDEX IF NOT EXISTS idx_medical_documents_processing_status
  ON medical_documents(processing_status);

CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_id
  ON prescriptions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_family_member_id
  ON prescriptions(family_member_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_status
  ON prescriptions(status);

CREATE INDEX IF NOT EXISTS idx_prescriptions_active
  ON prescriptions(family_member_id, status)
  WHERE status = 'active';

-- Búsqueda por nombre de medicamento (trgm)
CREATE INDEX IF NOT EXISTS idx_prescriptions_medication_name_trgm
  ON prescriptions USING GIN(medication_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medication_schedules_tenant_id
  ON medication_schedules(tenant_id);

CREATE INDEX IF NOT EXISTS idx_medication_schedules_prescription_id
  ON medication_schedules(prescription_id);

CREATE INDEX IF NOT EXISTS idx_medication_schedules_scheduled_at
  ON medication_schedules(scheduled_at);

CREATE INDEX IF NOT EXISTS idx_medication_schedules_pending
  ON medication_schedules(family_member_id, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_medical_tests_tenant_id
  ON medical_tests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_medical_tests_family_member_id
  ON medical_tests(family_member_id);

CREATE INDEX IF NOT EXISTS idx_medical_tests_status
  ON medical_tests(status);

-- Búsqueda fuzzy nombre de examen
CREATE INDEX IF NOT EXISTS idx_medical_tests_name_trgm
  ON medical_tests USING GIN(test_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_id
  ON reminders(tenant_id);

CREATE INDEX IF NOT EXISTS idx_reminders_family_member_id
  ON reminders(family_member_id);

CREATE INDEX IF NOT EXISTS idx_reminders_remind_at
  ON reminders(remind_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id
  ON audit_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at DESC);

-- ============================================================
-- Trigger set_updated_at (si no existe ya)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
