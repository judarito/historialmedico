-- ============================================================
-- 038 — Tokens de compartición de historial médico
-- ============================================================

-- Tabla principal de tokens
CREATE TABLE IF NOT EXISTS health_share_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  token       UUID        UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  member_id   UUID        NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  UUID        NOT NULL REFERENCES auth.users(id),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_health_share_tokens_token
  ON health_share_tokens(token);

CREATE INDEX IF NOT EXISTS idx_health_share_tokens_member_id
  ON health_share_tokens(member_id);

CREATE INDEX IF NOT EXISTS idx_health_share_tokens_tenant_active
  ON health_share_tokens(tenant_id, is_active);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_health_share_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_health_share_tokens_updated_at ON health_share_tokens;
CREATE TRIGGER trg_health_share_tokens_updated_at
  BEFORE UPDATE ON health_share_tokens
  FOR EACH ROW EXECUTE FUNCTION update_health_share_tokens_updated_at();

-- RLS
ALTER TABLE health_share_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_share_tokens' AND policyname = 'health_share_tokens_select'
  ) THEN
    CREATE POLICY health_share_tokens_select ON health_share_tokens
      FOR SELECT TO authenticated
      USING (user_belongs_to_tenant(tenant_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_share_tokens' AND policyname = 'health_share_tokens_insert'
  ) THEN
    CREATE POLICY health_share_tokens_insert ON health_share_tokens
      FOR INSERT TO authenticated
      WITH CHECK (user_belongs_to_tenant(tenant_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'health_share_tokens' AND policyname = 'health_share_tokens_update'
  ) THEN
    CREATE POLICY health_share_tokens_update ON health_share_tokens
      FOR UPDATE TO authenticated
      USING (user_belongs_to_tenant(tenant_id));
  END IF;
END $$;

-- ============================================================
-- RPC: generate_share_token
-- Genera un token de compartición para un miembro familiar.
-- Revoca tokens previos del mismo miembro y crea uno nuevo.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_share_token(
  p_member_id  UUID,
  p_ttl_hours  INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id  UUID;
  v_token      UUID;
  v_expires    TIMESTAMPTZ;
BEGIN
  -- Verificar que el miembro existe y obtener su tenant
  SELECT fm.tenant_id INTO v_tenant_id
  FROM family_members fm
  WHERE fm.id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Miembro no encontrado';
  END IF;

  -- Verificar que el usuario pertenece al tenant
  IF NOT user_belongs_to_tenant(v_tenant_id) THEN
    RAISE EXCEPTION 'No tienes permiso para compartir información de este miembro';
  END IF;

  -- Revocar tokens previos activos del mismo miembro
  UPDATE health_share_tokens
  SET is_active = false
  WHERE member_id = p_member_id
    AND is_active = true;

  -- Calcular expiración
  v_expires := NOW() + (p_ttl_hours || ' hours')::INTERVAL;
  v_token   := uuid_generate_v4();

  -- Insertar nuevo token
  INSERT INTO health_share_tokens (token, member_id, tenant_id, expires_at, created_by)
  VALUES (v_token, p_member_id, v_tenant_id, v_expires, auth.uid());

  RETURN jsonb_build_object(
    'token',      v_token,
    'expires_at', v_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION generate_share_token(UUID, INTEGER) TO authenticated;

-- ============================================================
-- RPC: get_shared_health_summary
-- Devuelve el resumen de salud de un miembro usando un token
-- público. No requiere autenticación (funciona con rol anon).
-- ============================================================
CREATE OR REPLACE FUNCTION get_shared_health_summary(
  p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_id UUID;
  v_member    JSONB;
  v_visits    JSONB;
  v_meds      JSONB;
  v_tests     JSONB;
BEGIN
  -- Buscar token válido
  SELECT member_id INTO v_member_id
  FROM health_share_tokens
  WHERE token      = p_token
    AND is_active  = true
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Token inválido o expirado');
  END IF;

  -- Datos del miembro
  SELECT jsonb_build_object(
    'first_name',              fm.first_name,
    'last_name',               fm.last_name,
    'birth_date',              fm.birth_date,
    'blood_type',              fm.blood_type,
    'allergies',               fm.allergies,
    'chronic_conditions',      fm.chronic_conditions,
    'emergency_contact_name',  fm.emergency_contact_name,
    'emergency_contact_phone', fm.emergency_contact_phone
  )
  INTO v_member
  FROM family_members fm
  WHERE fm.id = v_member_id;

  -- Últimas 5 visitas completadas
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'visit_date',     mv.visit_date,
        'doctor_name',    mv.doctor_name,
        'specialty',      mv.specialty,
        'diagnosis',      mv.diagnosis,
        'weight_kg',      mv.weight_kg,
        'heart_rate',     mv.heart_rate,
        'blood_pressure', mv.blood_pressure,
        'temperature_c',  mv.temperature_c
      )
      ORDER BY mv.visit_date DESC
    ),
    '[]'::jsonb
  )
  INTO v_visits
  FROM (
    SELECT mv.visit_date, mv.doctor_name, mv.specialty, mv.diagnosis,
           mv.weight_kg, mv.heart_rate, mv.blood_pressure, mv.temperature_c
    FROM medical_visits mv
    WHERE mv.family_member_id = v_member_id
      AND mv.status           = 'completed'
      AND mv.deleted_at IS NULL
    ORDER BY mv.visit_date DESC
    LIMIT 5
  ) mv;

  -- Medicamentos activos
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'medication_name', rx.medication_name,
        'dose_amount',     rx.dose_amount,
        'dose_unit',       rx.dose_unit,
        'frequency_text',  rx.frequency_text,
        'end_at',          rx.end_at
      )
      ORDER BY rx.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_meds
  FROM prescriptions rx
  WHERE rx.family_member_id = v_member_id
    AND rx.status           = 'active';

  -- Exámenes pendientes o programados
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'test_name', mt.test_name,
        'category',  mt.category,
        'due_at',    mt.due_at,
        'status',    mt.status
      )
      ORDER BY mt.due_at ASC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_tests
  FROM medical_tests mt
  WHERE mt.family_member_id = v_member_id
    AND mt.status IN ('pending', 'scheduled');

  RETURN jsonb_build_object(
    'member',              v_member,
    'recent_visits',       v_visits,
    'active_medications',  v_meds,
    'pending_tests',       v_tests
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_shared_health_summary(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_shared_health_summary(UUID) TO authenticated;
