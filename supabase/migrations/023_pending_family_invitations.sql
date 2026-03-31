-- ============================================================
-- 023 — Invitaciones pendientes para acceso compartido
--
-- Permite invitar correos que aun no tienen cuenta y reclamar
-- esa invitacion automaticamente cuando el usuario se registra
-- e inicia sesion con el mismo email.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'tenant_invitation_status'
  ) THEN
    CREATE TYPE tenant_invitation_status AS ENUM ('pending', 'accepted', 'cancelled', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         tenant_user_role NOT NULL DEFAULT 'member',
  status       tenant_invitation_status NOT NULL DEFAULT 'pending',
  invited_by   UUID REFERENCES auth.users(id),
  accepted_by  UUID REFERENCES auth.users(id),
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant_id
  ON public.tenant_invitations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email
  ON public.tenant_invitations((lower(email)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invitations_pending_email_unique
  ON public.tenant_invitations((lower(email)))
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_tenant_invitations_updated_at ON public.tenant_invitations;
CREATE TRIGGER trg_tenant_invitations_updated_at
BEFORE UPDATE ON public.tenant_invitations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_invitations_select" ON public.tenant_invitations;
DROP POLICY IF EXISTS "tenant_invitations_insert" ON public.tenant_invitations;
DROP POLICY IF EXISTS "tenant_invitations_update" ON public.tenant_invitations;
DROP POLICY IF EXISTS "tenant_invitations_delete" ON public.tenant_invitations;

CREATE POLICY "tenant_invitations_select" ON public.tenant_invitations
  FOR SELECT TO authenticated
  USING (user_belongs_to_tenant(tenant_id));

CREATE POLICY "tenant_invitations_insert" ON public.tenant_invitations
  FOR INSERT TO authenticated
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "tenant_invitations_update" ON public.tenant_invitations
  FOR UPDATE TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "tenant_invitations_delete" ON public.tenant_invitations
  FOR DELETE TO authenticated
  USING (is_tenant_admin(tenant_id));

DROP FUNCTION IF EXISTS public.invite_user_to_tenant(UUID, TEXT, tenant_user_role);
CREATE OR REPLACE FUNCTION public.invite_user_to_tenant(
  p_tenant_id UUID,
  p_email     TEXT,
  p_role      tenant_user_role DEFAULT 'member'
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id              UUID := auth.uid();
  v_normalized_email      TEXT := lower(trim(p_email));
  v_target_profile        profiles%ROWTYPE;
  v_existing_membership   tenant_users%ROWTYPE;
  v_existing_invitation   tenant_invitations%ROWTYPE;
  v_other_active_tenant   UUID;
  v_effective_role        tenant_user_role := p_role;
  v_status                TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Debes indicar el grupo familiar';
  END IF;

  IF COALESCE(v_normalized_email, '') = '' THEN
    RAISE EXCEPTION 'Debes indicar un correo electronico';
  END IF;

  IF NOT is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'No tienes permisos para habilitar usuarios en esta familia';
  END IF;

  IF v_effective_role = 'owner' THEN
    RAISE EXCEPTION 'El rol owner no se puede asignar desde esta funcion';
  END IF;

  SELECT *
  INTO v_target_profile
  FROM profiles
  WHERE lower(email) = v_normalized_email
  LIMIT 1;

  SELECT *
  INTO v_existing_invitation
  FROM tenant_invitations
  WHERE lower(email) = v_normalized_email
    AND status = 'pending'
  LIMIT 1;

  IF FOUND AND v_existing_invitation.tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'Ese correo ya tiene una invitacion pendiente a otra familia.';
  END IF;

  IF v_target_profile.id IS NOT NULL THEN
    IF v_target_profile.id = v_actor_id THEN
      RAISE EXCEPTION 'Tu usuario ya tiene acceso a esta familia';
    END IF;

    SELECT tu.tenant_id
    INTO v_other_active_tenant
    FROM tenant_users tu
    WHERE tu.user_id = v_target_profile.id
      AND tu.is_active = TRUE
      AND tu.tenant_id <> p_tenant_id
    ORDER BY COALESCE(tu.joined_at, tu.created_at) ASC
    LIMIT 1;

    IF v_other_active_tenant IS NOT NULL THEN
      RAISE EXCEPTION 'Este usuario ya pertenece a otro grupo familiar. Aun no soportamos varias familias por cuenta.';
    END IF;

    SELECT *
    INTO v_existing_membership
    FROM tenant_users
    WHERE tenant_id = p_tenant_id
      AND user_id = v_target_profile.id
    LIMIT 1;

    IF FOUND THEN
      IF v_existing_membership.role = 'owner' THEN
        v_effective_role := 'owner';
      END IF;

      UPDATE tenant_users
      SET
        role = v_effective_role,
        is_active = TRUE,
        invited_by = v_actor_id,
        joined_at = COALESCE(v_existing_membership.joined_at, NOW()),
        updated_at = NOW()
      WHERE id = v_existing_membership.id;

      v_status := CASE
        WHEN v_existing_membership.is_active = FALSE THEN 'reactivated'
        WHEN v_existing_membership.role <> v_effective_role THEN 'role_updated'
        ELSE 'already_member'
      END;
    ELSE
      INSERT INTO tenant_users (
        tenant_id,
        user_id,
        role,
        invited_by,
        joined_at,
        is_active
      ) VALUES (
        p_tenant_id,
        v_target_profile.id,
        v_effective_role,
        v_actor_id,
        NOW(),
        TRUE
      );

      v_status := 'invited';
    END IF;

    UPDATE profiles
    SET
      tenant_id = p_tenant_id,
      updated_at = NOW()
    WHERE id = v_target_profile.id
      AND tenant_id IS DISTINCT FROM p_tenant_id;

    UPDATE tenant_invitations
    SET
      status = 'accepted',
      accepted_by = v_target_profile.id,
      accepted_at = COALESCE(accepted_at, NOW()),
      updated_at = NOW()
    WHERE tenant_id = p_tenant_id
      AND lower(email) = v_normalized_email
      AND status = 'pending';
  ELSE
    IF v_existing_invitation.id IS NOT NULL THEN
      UPDATE tenant_invitations
      SET
        role = v_effective_role,
        invited_by = v_actor_id,
        updated_at = NOW()
      WHERE id = v_existing_invitation.id;

      v_status := 'invitation_updated';
    ELSE
      INSERT INTO tenant_invitations (
        tenant_id,
        email,
        role,
        status,
        invited_by
      ) VALUES (
        p_tenant_id,
        v_normalized_email,
        v_effective_role,
        'pending',
        v_actor_id
      );

      v_status := 'invitation_pending';
    END IF;
  END IF;

  PERFORM log_audit_event(
    p_tenant_id,
    'INVITE_TENANT_USER',
    'tenant_invitations',
    NULL,
    jsonb_build_object(
      'email', v_normalized_email,
      'target_user_id', v_target_profile.id,
      'role', v_effective_role,
      'status', v_status
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', v_status,
    'email', v_normalized_email,
    'role', v_effective_role,
    'user_id', v_target_profile.id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.claim_pending_tenant_invitations();
CREATE OR REPLACE FUNCTION public.claim_pending_tenant_invitations()
RETURNS JSONB AS $$
DECLARE
  v_user_id            UUID := auth.uid();
  v_email              TEXT := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
  v_current_tenant_id  UUID;
  v_invitation         tenant_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    SELECT lower(trim(email))
    INTO v_email
    FROM profiles
    WHERE id = v_user_id;
  END IF;

  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'missing_email');
  END IF;

  SELECT tenant_id
  INTO v_current_tenant_id
  FROM tenant_users
  WHERE user_id = v_user_id
    AND is_active = TRUE
  ORDER BY COALESCE(joined_at, created_at) ASC
  LIMIT 1;

  IF v_current_tenant_id IS NOT NULL THEN
    UPDATE profiles
    SET tenant_id = v_current_tenant_id
    WHERE id = v_user_id
      AND tenant_id IS DISTINCT FROM v_current_tenant_id;

    UPDATE tenant_invitations
    SET
      status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = COALESCE(accepted_at, NOW()),
      updated_at = NOW()
    WHERE lower(email) = v_email
      AND tenant_id = v_current_tenant_id
      AND status = 'pending';

    RETURN jsonb_build_object(
      'claimed', FALSE,
      'reason', 'already_has_tenant',
      'tenant_id', v_current_tenant_id
    );
  END IF;

  SELECT *
  INTO v_invitation
  FROM tenant_invitations
  WHERE lower(email) = v_email
    AND status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'no_pending_invitation');
  END IF;

  INSERT INTO tenant_users (
    tenant_id,
    user_id,
    role,
    invited_by,
    joined_at,
    is_active
  ) VALUES (
    v_invitation.tenant_id,
    v_user_id,
    v_invitation.role,
    v_invitation.invited_by,
    NOW(),
    TRUE
  )
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    is_active = TRUE,
    invited_by = COALESCE(tenant_users.invited_by, EXCLUDED.invited_by),
    joined_at = COALESCE(tenant_users.joined_at, EXCLUDED.joined_at),
    updated_at = NOW();

  UPDATE profiles
  SET
    tenant_id = v_invitation.tenant_id,
    updated_at = NOW()
  WHERE id = v_user_id
    AND tenant_id IS DISTINCT FROM v_invitation.tenant_id;

  UPDATE tenant_invitations
  SET
    status = 'accepted',
    accepted_by = v_user_id,
    accepted_at = NOW(),
    updated_at = NOW()
  WHERE id = v_invitation.id;

  PERFORM log_audit_event(
    v_invitation.tenant_id,
    'ACCEPT_TENANT_INVITATION',
    'tenant_invitations',
    v_invitation.id,
    jsonb_build_object(
      'email', v_email,
      'user_id', v_user_id,
      'role', v_invitation.role
    )
  );

  RETURN jsonb_build_object(
    'claimed', TRUE,
    'tenant_id', v_invitation.tenant_id,
    'invitation_id', v_invitation.id,
    'role', v_invitation.role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.get_tenant_access_members(UUID);
CREATE OR REPLACE FUNCTION public.get_tenant_access_members(
  p_tenant_id UUID
)
RETURNS TABLE (
  user_id         UUID,
  full_name       TEXT,
  email           TEXT,
  role            tenant_user_role,
  is_active       BOOLEAN,
  joined_at       TIMESTAMPTZ,
  is_current_user BOOLEAN
) AS $$
BEGIN
  IF NOT user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  SELECT
    tu.user_id,
    COALESCE(NULLIF(p.full_name, ''), split_part(COALESCE(p.email, ''), '@', 1), 'Usuario') AS full_name,
    p.email,
    tu.role,
    tu.is_active,
    COALESCE(tu.joined_at, tu.created_at) AS joined_at,
    tu.user_id = auth.uid() AS is_current_user
  FROM tenant_users tu
  LEFT JOIN profiles p
    ON p.id = tu.user_id
  WHERE tu.tenant_id = p_tenant_id
    AND tu.is_active = TRUE
  ORDER BY
    CASE tu.role
      WHEN 'owner'  THEN 0
      WHEN 'admin'  THEN 1
      WHEN 'member' THEN 2
      ELSE 3
    END,
    COALESCE(tu.joined_at, tu.created_at) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP FUNCTION IF EXISTS public.get_tenant_pending_invitations(UUID);
CREATE OR REPLACE FUNCTION public.get_tenant_pending_invitations(
  p_tenant_id UUID
)
RETURNS TABLE (
  invitation_id UUID,
  email         TEXT,
  role          tenant_user_role,
  status        tenant_invitation_status,
  invited_at    TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  RETURN QUERY
  SELECT
    ti.id,
    ti.email,
    ti.role,
    ti.status,
    ti.created_at
  FROM tenant_invitations ti
  WHERE ti.tenant_id = p_tenant_id
    AND ti.status = 'pending'
  ORDER BY ti.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
