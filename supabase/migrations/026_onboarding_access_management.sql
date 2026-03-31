-- ============================================================
-- 026 — Cierre de onboarding e invitaciones
--
-- 1. create_tenant_with_owner ahora crea la familia inicial en
--    la misma transaccion y tambien recupera tenants sin familia.
-- 2. Se agregan RPC para cambiar rol, cancelar invitaciones y
--    revocar accesos existentes.
-- 3. Se endurece invite_user_to_tenant para que los admins no
--    puedan promocionar otros administradores.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_name TEXT,
  p_slug TEXT,
  p_plan TEXT DEFAULT 'free'
)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id           UUID;
  v_family_id           UUID;
  v_user_id             UUID := auth.uid();
  v_existing_tenant_id  UUID;
  v_existing_family_id  UUID;
  v_effective_name      TEXT := trim(COALESCE(p_name, ''));
  v_effective_slug      TEXT := trim(COALESCE(p_slug, ''));
  v_effective_plan      TEXT := lower(trim(COALESCE(p_plan, 'free')));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF v_effective_name = '' THEN
    RAISE EXCEPTION 'Debes indicar el nombre del grupo familiar';
  END IF;

  IF v_effective_plan NOT IN ('free', 'pro', 'family') THEN
    RAISE EXCEPTION 'Plan no soportado: %', p_plan;
  END IF;

  SELECT tu.tenant_id
  INTO v_existing_tenant_id
  FROM tenant_users tu
  WHERE tu.user_id = v_user_id
    AND tu.is_active = TRUE
  ORDER BY COALESCE(tu.joined_at, tu.created_at) ASC
  LIMIT 1;

  IF v_existing_tenant_id IS NOT NULL THEN
    SELECT f.id
    INTO v_existing_family_id
    FROM families f
    WHERE f.tenant_id = v_existing_tenant_id
      AND f.is_active = TRUE
    ORDER BY f.created_at ASC
    LIMIT 1;

    IF v_existing_family_id IS NOT NULL THEN
      RAISE EXCEPTION 'Tu cuenta ya pertenece a un grupo familiar. Aun no soportamos varias familias por cuenta.';
    END IF;

    UPDATE tenants
    SET
      name = v_effective_name,
      plan = v_effective_plan,
      updated_at = NOW()
    WHERE id = v_existing_tenant_id;

    INSERT INTO families (tenant_id, name, created_by)
    VALUES (v_existing_tenant_id, v_effective_name, v_user_id)
    RETURNING id INTO v_family_id;

    UPDATE profiles
    SET
      tenant_id = v_existing_tenant_id,
      updated_at = NOW()
    WHERE id = v_user_id
      AND tenant_id IS DISTINCT FROM v_existing_tenant_id;

    PERFORM log_audit_event(
      v_existing_tenant_id,
      'COMPLETE_TENANT_FAMILY_SETUP',
      'families',
      v_family_id,
      jsonb_build_object(
        'name', v_effective_name,
        'plan', v_effective_plan
      )
    );

    RETURN jsonb_build_object(
      'tenant_id', v_existing_tenant_id,
      'family_id', v_family_id,
      'plan', v_effective_plan,
      'created_tenant', FALSE,
      'created_family', TRUE,
      'success', TRUE
    );
  END IF;

  IF v_effective_slug = '' THEN
    RAISE EXCEPTION 'Debes indicar un identificador para el grupo familiar';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tenants
    WHERE slug = v_effective_slug
  ) THEN
    RAISE EXCEPTION 'El slug "%" ya esta en uso', v_effective_slug;
  END IF;

  INSERT INTO tenants (name, slug, plan)
  VALUES (v_effective_name, v_effective_slug, v_effective_plan)
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_users (tenant_id, user_id, role, joined_at)
  VALUES (v_tenant_id, v_user_id, 'owner', NOW());

  UPDATE profiles
  SET
    tenant_id = v_tenant_id,
    updated_at = NOW()
  WHERE id = v_user_id
    AND tenant_id IS DISTINCT FROM v_tenant_id;

  INSERT INTO families (tenant_id, name, created_by)
  VALUES (v_tenant_id, v_effective_name, v_user_id)
  RETURNING id INTO v_family_id;

  PERFORM log_audit_event(
    v_tenant_id,
    'CREATE_TENANT',
    'tenants',
    v_tenant_id,
    jsonb_build_object(
      'name', v_effective_name,
      'slug', v_effective_slug,
      'plan', v_effective_plan,
      'family_id', v_family_id
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'family_id', v_family_id,
    'plan', v_effective_plan,
    'created_tenant', TRUE,
    'created_family', TRUE,
    'success', TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.invite_user_to_tenant(
  p_tenant_id UUID,
  p_email     TEXT,
  p_role      tenant_user_role DEFAULT 'member'
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id              UUID := auth.uid();
  v_actor_membership      tenant_users%ROWTYPE;
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

  SELECT *
  INTO v_actor_membership
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = v_actor_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_actor_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para habilitar usuarios en esta familia';
  END IF;

  IF v_effective_role = 'owner' THEN
    RAISE EXCEPTION 'El rol owner no se puede asignar desde esta funcion';
  END IF;

  IF v_actor_membership.role = 'admin' AND v_effective_role = 'admin' THEN
    RAISE EXCEPTION 'Solo el propietario puede invitar administradores';
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

  IF v_actor_membership.role = 'admin'
    AND v_existing_invitation.id IS NOT NULL
    AND (v_existing_invitation.role = 'admin' OR v_effective_role = 'admin') THEN
    RAISE EXCEPTION 'Solo el propietario puede gestionar invitaciones con rol administrador';
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

      IF v_actor_membership.role = 'admin'
        AND (v_existing_membership.role = 'admin' OR v_effective_role = 'admin') THEN
        RAISE EXCEPTION 'Solo el propietario puede gestionar administradores';
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

DROP FUNCTION IF EXISTS public.update_tenant_user_role(UUID, UUID, tenant_user_role);
CREATE OR REPLACE FUNCTION public.update_tenant_user_role(
  p_tenant_id UUID,
  p_user_id   UUID,
  p_role      tenant_user_role
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id         UUID := auth.uid();
  v_actor_membership tenant_users%ROWTYPE;
  v_target_membership tenant_users%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'El rol owner no se puede asignar desde esta funcion';
  END IF;

  SELECT *
  INTO v_actor_membership
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = v_actor_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_actor_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para gestionar accesos en esta familia';
  END IF;

  SELECT *
  INTO v_target_membership
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos un acceso activo para este usuario';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol desde esta pantalla';
  END IF;

  IF v_target_membership.role = 'owner' THEN
    RAISE EXCEPTION 'No puedes modificar el rol del propietario';
  END IF;

  IF v_actor_membership.role = 'admin'
    AND (v_target_membership.role = 'admin' OR p_role = 'admin') THEN
    RAISE EXCEPTION 'Solo el propietario puede gestionar administradores';
  END IF;

  IF v_target_membership.role = p_role THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'unchanged',
      'user_id', p_user_id,
      'role', p_role
    );
  END IF;

  UPDATE tenant_users
  SET
    role = p_role,
    updated_at = NOW()
  WHERE id = v_target_membership.id;

  PERFORM log_audit_event(
    p_tenant_id,
    'UPDATE_TENANT_ACCESS_ROLE',
    'tenant_users',
    v_target_membership.id,
    jsonb_build_object(
      'user_id', p_user_id,
      'previous_role', v_target_membership.role,
      'next_role', p_role
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'updated',
    'user_id', p_user_id,
    'role', p_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.update_tenant_invitation_role(UUID, tenant_user_role);
CREATE OR REPLACE FUNCTION public.update_tenant_invitation_role(
  p_invitation_id UUID,
  p_role          tenant_user_role
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id         UUID := auth.uid();
  v_actor_membership tenant_users%ROWTYPE;
  v_invitation       tenant_invitations%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'El rol owner no se puede asignar desde esta funcion';
  END IF;

  SELECT *
  INTO v_invitation
  FROM tenant_invitations
  WHERE id = p_invitation_id
    AND status = 'pending'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos una invitacion pendiente con ese identificador';
  END IF;

  SELECT *
  INTO v_actor_membership
  FROM tenant_users
  WHERE tenant_id = v_invitation.tenant_id
    AND user_id = v_actor_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_actor_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para gestionar invitaciones en esta familia';
  END IF;

  IF v_actor_membership.role = 'admin'
    AND (v_invitation.role = 'admin' OR p_role = 'admin') THEN
    RAISE EXCEPTION 'Solo el propietario puede gestionar invitaciones con rol administrador';
  END IF;

  IF v_invitation.role = p_role THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'status', 'unchanged',
      'invitation_id', p_invitation_id,
      'role', p_role
    );
  END IF;

  UPDATE tenant_invitations
  SET
    role = p_role,
    updated_at = NOW()
  WHERE id = v_invitation.id;

  PERFORM log_audit_event(
    v_invitation.tenant_id,
    'UPDATE_TENANT_INVITATION_ROLE',
    'tenant_invitations',
    v_invitation.id,
    jsonb_build_object(
      'email', v_invitation.email,
      'previous_role', v_invitation.role,
      'next_role', p_role
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'updated',
    'invitation_id', p_invitation_id,
    'role', p_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.cancel_tenant_invitation(UUID);
CREATE OR REPLACE FUNCTION public.cancel_tenant_invitation(
  p_invitation_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id         UUID := auth.uid();
  v_actor_membership tenant_users%ROWTYPE;
  v_invitation       tenant_invitations%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_invitation
  FROM tenant_invitations
  WHERE id = p_invitation_id
    AND status = 'pending'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos una invitacion pendiente con ese identificador';
  END IF;

  SELECT *
  INTO v_actor_membership
  FROM tenant_users
  WHERE tenant_id = v_invitation.tenant_id
    AND user_id = v_actor_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_actor_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para cancelar invitaciones en esta familia';
  END IF;

  IF v_actor_membership.role = 'admin' AND v_invitation.role = 'admin' THEN
    RAISE EXCEPTION 'Solo el propietario puede cancelar invitaciones con rol administrador';
  END IF;

  UPDATE tenant_invitations
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = v_invitation.id;

  PERFORM log_audit_event(
    v_invitation.tenant_id,
    'CANCEL_TENANT_INVITATION',
    'tenant_invitations',
    v_invitation.id,
    jsonb_build_object(
      'email', v_invitation.email,
      'role', v_invitation.role
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'cancelled',
    'invitation_id', p_invitation_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.revoke_tenant_user_access(UUID, UUID);
CREATE OR REPLACE FUNCTION public.revoke_tenant_user_access(
  p_tenant_id UUID,
  p_user_id   UUID
)
RETURNS JSONB AS $$
DECLARE
  v_actor_id          UUID := auth.uid();
  v_actor_membership  tenant_users%ROWTYPE;
  v_target_membership tenant_users%ROWTYPE;
  v_next_tenant_id    UUID;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  SELECT *
  INTO v_actor_membership
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = v_actor_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_actor_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para revocar accesos en esta familia';
  END IF;

  SELECT *
  INTO v_target_membership
  FROM tenant_users
  WHERE tenant_id = p_tenant_id
    AND user_id = p_user_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos un acceso activo para este usuario';
  END IF;

  IF p_user_id = v_actor_id THEN
    RAISE EXCEPTION 'No puedes revocar tu propio acceso desde esta pantalla';
  END IF;

  IF v_target_membership.role = 'owner' THEN
    RAISE EXCEPTION 'No puedes revocar el acceso del propietario';
  END IF;

  IF v_actor_membership.role = 'admin' AND v_target_membership.role = 'admin' THEN
    RAISE EXCEPTION 'Solo el propietario puede revocar el acceso de un administrador';
  END IF;

  UPDATE tenant_users
  SET
    is_active = FALSE,
    updated_at = NOW()
  WHERE id = v_target_membership.id;

  SELECT tu.tenant_id
  INTO v_next_tenant_id
  FROM tenant_users tu
  WHERE tu.user_id = p_user_id
    AND tu.is_active = TRUE
    AND tu.tenant_id <> p_tenant_id
  ORDER BY COALESCE(tu.joined_at, tu.created_at) ASC
  LIMIT 1;

  UPDATE profiles
  SET
    tenant_id = v_next_tenant_id,
    updated_at = NOW()
  WHERE id = p_user_id
    AND tenant_id IS DISTINCT FROM v_next_tenant_id;

  PERFORM log_audit_event(
    p_tenant_id,
    'REVOKE_TENANT_ACCESS',
    'tenant_users',
    v_target_membership.id,
    jsonb_build_object(
      'user_id', p_user_id,
      'role', v_target_membership.role,
      'next_tenant_id', v_next_tenant_id
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'revoked',
    'user_id', p_user_id,
    'next_tenant_id', v_next_tenant_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
