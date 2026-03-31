-- ============================================================
-- 024 — Onboarding de tenant con plan explicito
--
-- Permite seleccionar el plan al crear una familia propia y
-- bloquea la creacion de multiples familias por la misma cuenta.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_tenant_with_owner(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_tenant_with_owner(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(
  p_name TEXT,
  p_slug TEXT,
  p_plan TEXT DEFAULT 'free'
)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id           UUID;
  v_user_id             UUID := auth.uid();
  v_existing_tenant_id  UUID;
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

  IF v_effective_slug = '' THEN
    RAISE EXCEPTION 'Debes indicar un identificador para el grupo familiar';
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
    RAISE EXCEPTION 'Tu cuenta ya pertenece a un grupo familiar. Aun no soportamos varias familias por cuenta.';
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

  PERFORM log_audit_event(
    v_tenant_id,
    'CREATE_TENANT',
    'tenants',
    v_tenant_id,
    jsonb_build_object(
      'name', v_effective_name,
      'slug', v_effective_slug,
      'plan', v_effective_plan
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'plan', v_effective_plan,
    'success', TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
