-- ============================================================
-- Family Health Tracker — Acceso compartido al grupo familiar
-- Migration: 021_shared_family_access.sql
-- Permite habilitar a otros usuarios ya registrados dentro
-- del mismo tenant y listar quiénes tienen acceso.
-- ============================================================

DROP FUNCTION IF EXISTS public.invite_user_to_tenant(UUID, TEXT, tenant_user_role);
CREATE FUNCTION public.invite_user_to_tenant(
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos una cuenta registrada con el correo %', v_normalized_email;
  END IF;

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

  PERFORM log_audit_event(
    p_tenant_id,
    'INVITE_TENANT_USER',
    'tenant_users',
    v_target_profile.id,
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

DROP FUNCTION IF EXISTS public.get_tenant_access_members(UUID);
CREATE FUNCTION public.get_tenant_access_members(
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
