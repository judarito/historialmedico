-- ============================================================
-- Family Health Tracker — Schema PostgreSQL/Supabase
-- Migration: 001_schema.sql
-- Multi-tenant SaaS — Datos médicos sensibles
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- búsqueda fuzzy
CREATE EXTENSION IF NOT EXISTS "unaccent";       -- búsqueda sin tildes

-- ============================================================
-- TIPOS ENUMERADOS
-- ============================================================
CREATE TYPE tenant_user_role AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE member_relationship AS ENUM ('child', 'parent', 'guardian', 'grandparent', 'sibling', 'other');
CREATE TYPE member_sex AS ENUM ('male', 'female', 'other');
CREATE TYPE blood_type AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown');
CREATE TYPE medication_route AS ENUM ('oral', 'topical', 'inhalation', 'injectable', 'ophthalmic', 'otic', 'nasal', 'sublingual', 'rectal', 'other');
CREATE TYPE medication_frequency AS ENUM ('once', 'twice_daily', 'three_daily', 'four_daily', 'every_6h', 'every_8h', 'every_12h', 'every_24h', 'as_needed', 'weekly', 'other');
CREATE TYPE dose_status AS ENUM ('pending', 'taken', 'skipped', 'late');
CREATE TYPE test_status AS ENUM ('ordered', 'scheduled', 'completed', 'cancelled');
CREATE TYPE prescription_status AS ENUM ('pending_review', 'confirmed', 'rejected');
CREATE TYPE document_type AS ENUM ('prescription', 'lab_result', 'imaging', 'report', 'other');
CREATE TYPE reminder_type AS ENUM ('medication', 'exam', 'appointment', 'other');

-- ============================================================
-- TABLA: tenants
-- ============================================================
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',   -- free | pro | family
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ============================================================
-- TABLA: profiles
-- (extiende auth.users de Supabase Auth)
-- ============================================================
CREATE TABLE profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name       TEXT,
    avatar_url      TEXT,
    phone           TEXT,
    locale          TEXT DEFAULT 'es',
    push_token      TEXT,        -- Expo push token para notificaciones
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_tenant_id ON profiles(tenant_id);

-- ============================================================
-- TABLA: tenant_users
-- Relación usuario <-> tenant con rol
-- ============================================================
CREATE TABLE tenant_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role            tenant_user_role NOT NULL DEFAULT 'member',
    invited_by      UUID REFERENCES auth.users(id),
    joined_at       TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

CREATE INDEX idx_tenant_users_tenant_id ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user_id   ON tenant_users(user_id);

-- ============================================================
-- TABLA: families
-- ============================================================
CREATE TABLE families (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    avatar_url      TEXT,
    created_by      UUID NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_families_tenant_id ON families(tenant_id);

-- ============================================================
-- TABLA: family_members
-- ============================================================
CREATE TABLE family_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    date_of_birth       DATE,
    relationship        member_relationship NOT NULL DEFAULT 'other',
    sex                 member_sex,
    blood_type          blood_type DEFAULT 'unknown',
    eps                 TEXT,                          -- aseguradora/EPS
    id_number           TEXT,                          -- cédula o tarjeta de identidad
    allergies           TEXT[],                        -- array de alergias
    chronic_conditions  TEXT[],                        -- condiciones crónicas
    notes               TEXT,
    avatar_url          TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    -- búsqueda full-text
    search_vector       TSVECTOR,
    created_by          UUID NOT NULL REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- integridad: family debe pertenecer al mismo tenant
    CONSTRAINT fk_family_member_tenant CHECK (
        EXISTS (
            SELECT 1 FROM families f
            WHERE f.id = family_id AND f.tenant_id = tenant_id
        )
    )
);

CREATE INDEX idx_family_members_tenant_id  ON family_members(tenant_id);
CREATE INDEX idx_family_members_family_id  ON family_members(family_id);
CREATE INDEX idx_family_members_search     ON family_members USING GIN(search_vector);
CREATE INDEX idx_family_members_name_trgm  ON family_members USING GIN(full_name gin_trgm_ops);

-- Trigger para actualizar search_vector
CREATE OR REPLACE FUNCTION update_family_member_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('spanish', coalesce(NEW.full_name, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string(NEW.allergies, ' '), '')), 'B') ||
        setweight(to_tsvector('spanish', coalesce(array_to_string(NEW.chronic_conditions, ' '), '')), 'B') ||
        setweight(to_tsvector('spanish', coalesce(NEW.notes, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_family_member_search
    BEFORE INSERT OR UPDATE ON family_members
    FOR EACH ROW EXECUTE FUNCTION update_family_member_search_vector();

-- ============================================================
-- TABLA: medical_visits
-- ============================================================
CREATE TABLE medical_visits (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    visit_date          DATE NOT NULL,
    doctor_name         TEXT,
    specialty           TEXT,
    institution         TEXT,
    reason              TEXT NOT NULL,
    diagnosis           TEXT,
    observations        TEXT,
    -- signos vitales (opcional)
    vitals              JSONB DEFAULT '{}',
    -- ej: {"weight_kg": 25.5, "height_cm": 115, "temp_c": 37.2, "bp_systolic": 110, "bp_diastolic": 70}
    follow_up_date      DATE,
    search_vector       TSVECTOR,
    created_by          UUID NOT NULL REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_visit_family_tenant CHECK (
        EXISTS (
            SELECT 1 FROM family_members fm
            WHERE fm.id = family_member_id
              AND fm.family_id = family_id
              AND fm.tenant_id = tenant_id
        )
    )
);

CREATE INDEX idx_medical_visits_tenant_id        ON medical_visits(tenant_id);
CREATE INDEX idx_medical_visits_family_member_id ON medical_visits(family_member_id);
CREATE INDEX idx_medical_visits_visit_date       ON medical_visits(visit_date DESC);
CREATE INDEX idx_medical_visits_search           ON medical_visits USING GIN(search_vector);

CREATE OR REPLACE FUNCTION update_medical_visit_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('spanish', coalesce(NEW.doctor_name, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.specialty, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.diagnosis, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.reason, '')), 'B') ||
        setweight(to_tsvector('spanish', coalesce(NEW.institution, '')), 'C') ||
        setweight(to_tsvector('spanish', coalesce(NEW.observations, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_medical_visit_search
    BEFORE INSERT OR UPDATE ON medical_visits
    FOR EACH ROW EXECUTE FUNCTION update_medical_visit_search_vector();

-- ============================================================
-- TABLA: medical_documents
-- ============================================================
CREATE TABLE medical_documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    visit_id            UUID REFERENCES medical_visits(id) ON DELETE SET NULL,
    document_type       document_type NOT NULL DEFAULT 'other',
    title               TEXT NOT NULL,
    description         TEXT,
    storage_path        TEXT NOT NULL,   -- path en Supabase Storage
    file_size_bytes     BIGINT,
    mime_type           TEXT,
    is_processed        BOOLEAN DEFAULT FALSE,  -- si ya fue procesado por IA
    created_by          UUID NOT NULL REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medical_documents_tenant_id       ON medical_documents(tenant_id);
CREATE INDEX idx_medical_documents_family_member   ON medical_documents(family_member_id);
CREATE INDEX idx_medical_documents_visit_id        ON medical_documents(visit_id);
CREATE INDEX idx_medical_documents_type            ON medical_documents(document_type);

-- ============================================================
-- TABLA: prescriptions
-- Fórmulas médicas (imagen + datos extraídos por IA)
-- ============================================================
CREATE TABLE prescriptions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    visit_id            UUID REFERENCES medical_visits(id) ON DELETE SET NULL,
    document_id         UUID REFERENCES medical_documents(id) ON DELETE SET NULL,
    -- datos extraídos por IA
    status              prescription_status NOT NULL DEFAULT 'pending_review',
    prescription_date   DATE,
    doctor_name         TEXT,
    diagnosis           TEXT,
    notes               TEXT,
    -- JSON raw retornado por el LLM (para auditoría y re-procesamiento)
    ai_raw_output       JSONB,
    -- confianza del modelo (0-1)
    ai_confidence       NUMERIC(4,3),
    -- quién confirmó los datos
    confirmed_by        UUID REFERENCES auth.users(id),
    confirmed_at        TIMESTAMPTZ,
    search_vector       TSVECTOR,
    created_by          UUID NOT NULL REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_tenant_id       ON prescriptions(tenant_id);
CREATE INDEX idx_prescriptions_family_member   ON prescriptions(family_member_id);
CREATE INDEX idx_prescriptions_status          ON prescriptions(status);
CREATE INDEX idx_prescriptions_date            ON prescriptions(prescription_date DESC);
CREATE INDEX idx_prescriptions_search          ON prescriptions USING GIN(search_vector);

CREATE OR REPLACE FUNCTION update_prescription_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('spanish', coalesce(NEW.doctor_name, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.diagnosis, '')), 'A') ||
        setweight(to_tsvector('spanish', coalesce(NEW.notes, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prescription_search
    BEFORE INSERT OR UPDATE ON prescriptions
    FOR EACH ROW EXECUTE FUNCTION update_prescription_search_vector();

-- ============================================================
-- TABLA: prescription_medications
-- Medicamentos extraídos de una fórmula
-- ============================================================
CREATE TABLE prescription_medications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prescription_id     UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    -- datos del medicamento
    name                TEXT NOT NULL,
    presentation        TEXT,               -- "Jarabe 250mg/5ml", "Tabletas 500mg"
    dose_amount         NUMERIC(10,3),
    dose_unit           TEXT,               -- "mg", "ml", "gotas", "tabletas"
    frequency_text      TEXT,               -- texto libre de la fórmula
    frequency           medication_frequency DEFAULT 'other',
    interval_hours      NUMERIC(5,2),       -- calculado automáticamente
    duration_days       INTEGER,
    route               medication_route DEFAULT 'oral',
    instructions        TEXT,               -- indicaciones especiales
    is_as_needed        BOOLEAN DEFAULT FALSE,  -- "según necesidad"
    -- control de tratamiento
    start_date          DATE,
    end_date            DATE,               -- calculado de start_date + duration_days
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prescription_medications_tenant_id    ON prescription_medications(tenant_id);
CREATE INDEX idx_prescription_medications_prescription ON prescription_medications(prescription_id);
CREATE INDEX idx_prescription_medications_member       ON prescription_medications(family_member_id);
CREATE INDEX idx_prescription_medications_name_trgm   ON prescription_medications USING GIN(name gin_trgm_ops);
CREATE INDEX idx_prescription_medications_active       ON prescription_medications(family_member_id, is_active) WHERE is_active = TRUE;

-- ============================================================
-- TABLA: medication_schedules
-- Horarios generados automáticamente por medicamento
-- ============================================================
CREATE TABLE medication_schedules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    medication_id       UUID NOT NULL REFERENCES prescription_medications(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    scheduled_at        TIMESTAMPTZ NOT NULL,
    dose_number         INTEGER NOT NULL,   -- número de dosis en el tratamiento
    dose_label          TEXT,               -- ej: "Dosis 1 de 14"
    status              dose_status NOT NULL DEFAULT 'pending',
    taken_at            TIMESTAMPTZ,        -- cuándo se marcó como tomada
    taken_by            UUID REFERENCES auth.users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medication_schedules_tenant_id     ON medication_schedules(tenant_id);
CREATE INDEX idx_medication_schedules_medication    ON medication_schedules(medication_id);
CREATE INDEX idx_medication_schedules_member        ON medication_schedules(family_member_id);
CREATE INDEX idx_medication_schedules_scheduled     ON medication_schedules(scheduled_at);
CREATE INDEX idx_medication_schedules_status        ON medication_schedules(status, scheduled_at) WHERE status = 'pending';

-- ============================================================
-- TABLA: prescription_tests
-- Exámenes ordenados en una fórmula
-- ============================================================
CREATE TABLE prescription_tests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prescription_id     UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    category            TEXT,               -- "laboratorio", "imagen", "especialidad"
    instructions        TEXT,
    status              test_status NOT NULL DEFAULT 'ordered',
    scheduled_date      DATE,
    completed_date      DATE,
    result_document_id  UUID REFERENCES medical_documents(id),
    result_summary      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prescription_tests_tenant_id    ON prescription_tests(tenant_id);
CREATE INDEX idx_prescription_tests_member       ON prescription_tests(family_member_id);
CREATE INDEX idx_prescription_tests_status       ON prescription_tests(status);
CREATE INDEX idx_prescription_tests_name_trgm   ON prescription_tests USING GIN(name gin_trgm_ops);

-- ============================================================
-- TABLA: reminders
-- Recordatorios de dosis y exámenes
-- ============================================================
CREATE TABLE reminders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    family_member_id    UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES auth.users(id),   -- a quién notificar
    reminder_type       reminder_type NOT NULL DEFAULT 'medication',
    -- referencia polimórfica
    schedule_id         UUID REFERENCES medication_schedules(id) ON DELETE CASCADE,
    test_id             UUID REFERENCES prescription_tests(id)    ON DELETE CASCADE,
    title               TEXT NOT NULL,
    body                TEXT,
    remind_at           TIMESTAMPTZ NOT NULL,
    is_sent             BOOLEAN DEFAULT FALSE,
    sent_at             TIMESTAMPTZ,
    -- resultado del push
    push_receipt        JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reminders_tenant_id   ON reminders(tenant_id);
CREATE INDEX idx_reminders_user_id     ON reminders(user_id);
CREATE INDEX idx_reminders_remind_at   ON reminders(remind_at) WHERE is_sent = FALSE;
CREATE INDEX idx_reminders_member      ON reminders(family_member_id);

-- ============================================================
-- TABLA: audit_logs
-- Auditoría completa del tenant
-- ============================================================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES auth.users(id),
    action          TEXT NOT NULL,          -- INSERT, UPDATE, DELETE, AI_PROCESS, etc.
    table_name      TEXT NOT NULL,
    record_id       UUID,
    old_data        JSONB,
    new_data        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant_id  ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_table      ON audit_logs(table_name);
CREATE INDEX idx_audit_logs_created    ON audit_logs(created_at DESC);

-- ============================================================
-- TRIGGERS: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'tenants', 'profiles', 'tenant_users', 'families',
            'family_members', 'medical_visits', 'medical_documents',
            'prescriptions', 'prescription_medications',
            'medication_schedules', 'prescription_tests', 'reminders'
        ])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            t, t
        );
    END LOOP;
END;
$$;

-- ============================================================
-- TRIGGER: crear profile automáticamente al registrar usuario
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- El tenant_id se asignará después durante el onboarding
    -- Por ahora insertamos sin tenant_id, se actualiza en el flujo de onboarding
    INSERT INTO profiles (id, full_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- NOTA SEGURIDAD: SECURITY DEFINER es necesario aquí porque el trigger
-- corre en el contexto de auth.users (esquema de Supabase) y necesita
-- escribir en public.profiles. Se justifica porque la función solo hace
-- INSERT controlado y no expone datos de otros usuarios.

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
