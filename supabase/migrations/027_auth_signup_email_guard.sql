-- ============================================================
-- 027 — Guard de correo repetido en signup
--
-- Expone una RPC minima para saber si un correo ya existe en
-- auth.users y si ya confirmo email, de modo que la app no
-- muestre "Cuenta creada" cuando Supabase devuelve una respuesta
-- ofuscada para evitar enumeracion.
-- ============================================================

DROP FUNCTION IF EXISTS public.check_auth_email_status(TEXT);
CREATE OR REPLACE FUNCTION public.check_auth_email_status(
  p_email TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_user  RECORD;
BEGIN
  IF v_email = '' THEN
    RETURN jsonb_build_object(
      'exists', FALSE,
      'confirmed', FALSE
    );
  END IF;

  SELECT
    id,
    email_confirmed_at
  INTO v_user
  FROM auth.users
  WHERE lower(email) = v_email
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'exists', FOUND,
    'confirmed', CASE
      WHEN FOUND THEN v_user.email_confirmed_at IS NOT NULL
      ELSE FALSE
    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_auth_email_status(TEXT) TO anon, authenticated;
