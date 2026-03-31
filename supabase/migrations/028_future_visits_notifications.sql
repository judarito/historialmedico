-- ============================================================
-- 028 -- Visitas futuras + centro de notificaciones
--
-- 1. Habilita el estado "scheduled" para medical_visits.
-- 2. Sincroniza recordatorios de citas futuras en reminders.
-- 3. Agrega notification_reads para estado de lectura por usuario.
-- 4. Expone RPC para feed, conteo no leido y marcado de lectura.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'visit_status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'visit_status'
      AND e.enumlabel = 'scheduled'
  ) THEN
    ALTER TYPE visit_status ADD VALUE 'scheduled';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notification_reads (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reminder_id  UUID NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_reads_reminder_user_unique
  ON public.notification_reads(reminder_id, user_id);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id
  ON public.notification_reads(user_id, read_at DESC);

DROP TRIGGER IF EXISTS trg_notification_reads_updated_at ON public.notification_reads;
CREATE TRIGGER trg_notification_reads_updated_at
BEFORE UPDATE ON public.notification_reads
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_reads_select" ON public.notification_reads;
DROP POLICY IF EXISTS "notification_reads_insert" ON public.notification_reads;
DROP POLICY IF EXISTS "notification_reads_update" ON public.notification_reads;
DROP POLICY IF EXISTS "notification_reads_delete" ON public.notification_reads;

CREATE POLICY "notification_reads_select" ON public.notification_reads
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reminders r
      WHERE r.id = reminder_id
        AND public.user_belongs_to_tenant(r.tenant_id)
    )
  );

CREATE POLICY "notification_reads_insert" ON public.notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reminders r
      WHERE r.id = reminder_id
        AND public.user_belongs_to_tenant(r.tenant_id)
    )
  );

CREATE POLICY "notification_reads_update" ON public.notification_reads
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reminders r
      WHERE r.id = reminder_id
        AND public.user_belongs_to_tenant(r.tenant_id)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reminders r
      WHERE r.id = reminder_id
        AND public.user_belongs_to_tenant(r.tenant_id)
    )
  );

CREATE POLICY "notification_reads_delete" ON public.notification_reads
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reminders r
      WHERE r.id = reminder_id
        AND public.user_belongs_to_tenant(r.tenant_id)
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique_appointment_visit
  ON public.reminders(medical_visit_id, reminder_type)
  WHERE reminder_type = 'appointment';

CREATE INDEX IF NOT EXISTS idx_medical_visits_upcoming_scheduled
  ON public.medical_visits(tenant_id, status, visit_date)
  WHERE deleted_at IS NULL;

DROP FUNCTION IF EXISTS public.compute_visit_appointment_remind_at(TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.compute_visit_appointment_remind_at(
  p_visit_date TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_visit_date IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_visit_date - INTERVAL '24 hours' > v_now THEN
    RETURN p_visit_date - INTERVAL '24 hours';
  END IF;

  IF p_visit_date - INTERVAL '2 hours' > v_now THEN
    RETURN p_visit_date - INTERVAL '2 hours';
  END IF;

  IF p_visit_date - INTERVAL '15 minutes' > v_now THEN
    RETURN p_visit_date - INTERVAL '15 minutes';
  END IF;

  RETURN p_visit_date;
END;
$$ LANGUAGE plpgsql STABLE;

DROP FUNCTION IF EXISTS public.sync_medical_visit_appointment_reminder(UUID);
CREATE OR REPLACE FUNCTION public.sync_medical_visit_appointment_reminder(
  p_visit_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_visit         public.medical_visits%ROWTYPE;
  v_member_name   TEXT;
  v_context       TEXT;
  v_message       TEXT;
  v_title         TEXT;
  v_reminder_id   UUID;
  v_remind_at     TIMESTAMPTZ;
  v_visit_date    TIMESTAMPTZ;
  v_time_label    TEXT;
  v_date_label    TEXT;
BEGIN
  IF p_visit_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_visit
  FROM public.medical_visits
  WHERE id = p_visit_id;

  IF NOT FOUND THEN
    DELETE FROM public.reminders
    WHERE medical_visit_id = p_visit_id
      AND reminder_type = 'appointment';
    RETURN;
  END IF;

  v_visit_date := v_visit.visit_date;

  IF v_visit.deleted_at IS NOT NULL
    OR v_visit.status::TEXT <> 'scheduled'
    OR v_visit_date IS NULL
    OR v_visit_date <= NOW() THEN
    DELETE FROM public.reminders
    WHERE medical_visit_id = v_visit.id
      AND reminder_type = 'appointment';
    RETURN;
  END IF;

  v_remind_at := public.compute_visit_appointment_remind_at(v_visit_date);

  SELECT trim(concat_ws(' ', fm.first_name, fm.last_name))
  INTO v_member_name
  FROM public.family_members fm
  WHERE fm.id = v_visit.family_member_id;

  v_context := COALESCE(
    NULLIF(trim(concat_ws(' con ', NULLIF(trim(v_visit.specialty), ''), NULLIF(trim(v_visit.doctor_name), ''))), ''),
    NULLIF(trim(v_visit.doctor_name), ''),
    NULLIF(trim(v_visit.specialty), ''),
    NULLIF(trim(v_visit.reason_for_visit), ''),
    'consulta medica'
  );

  v_date_label := to_char(v_visit_date AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY');
  v_time_label := trim(to_char(v_visit_date AT TIME ZONE 'America/Bogota', 'HH12:MI AM'));
  v_title := format('Cita medica: %s', COALESCE(NULLIF(v_member_name, ''), 'familiar'));
  v_message := format(
    '%s el %s a las %s%s',
    v_context,
    v_date_label,
    v_time_label,
    CASE
      WHEN NULLIF(trim(COALESCE(v_visit.institution_name, '')), '') IS NOT NULL
        THEN format(' en %s', trim(v_visit.institution_name))
      ELSE ''
    END
  );

  INSERT INTO public.reminders (
    tenant_id,
    family_id,
    family_member_id,
    medical_visit_id,
    reminder_type,
    title,
    message,
    remind_at,
    status,
    sent_at,
    read_at,
    push_receipt
  )
  VALUES (
    v_visit.tenant_id,
    v_visit.family_id,
    v_visit.family_member_id,
    v_visit.id,
    'appointment',
    v_title,
    v_message,
    v_remind_at,
    'pending',
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (medical_visit_id, reminder_type) WHERE reminder_type = 'appointment'
  DO UPDATE
    SET
      tenant_id = EXCLUDED.tenant_id,
      family_id = EXCLUDED.family_id,
      family_member_id = EXCLUDED.family_member_id,
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      remind_at = EXCLUDED.remind_at,
      status = 'pending',
      sent_at = NULL,
      read_at = NULL,
      push_receipt = NULL,
      updated_at = NOW()
  RETURNING id INTO v_reminder_id;

  IF v_reminder_id IS NOT NULL THEN
    DELETE FROM public.notification_reads
    WHERE reminder_id = v_reminder_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.trg_sync_medical_visit_appointment_reminder();
CREATE OR REPLACE FUNCTION public.trg_sync_medical_visit_appointment_reminder()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reminders
    WHERE medical_visit_id = OLD.id
      AND reminder_type = 'appointment';
    RETURN OLD;
  END IF;

  PERFORM public.sync_medical_visit_appointment_reminder(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_medical_visit_appointment_reminder ON public.medical_visits;
CREATE TRIGGER trg_sync_medical_visit_appointment_reminder
AFTER INSERT OR UPDATE OF visit_date, doctor_name, specialty, institution_name, reason_for_visit, status, deleted_at
ON public.medical_visits
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_medical_visit_appointment_reminder();

DROP FUNCTION IF EXISTS public.get_notification_feed(UUID, INTEGER);
CREATE OR REPLACE FUNCTION public.get_notification_feed(
  p_tenant_id UUID,
  p_limit     INTEGER DEFAULT 50
)
RETURNS TABLE (
  reminder_id            UUID,
  reminder_type          reminder_type,
  title                  TEXT,
  message                TEXT,
  remind_at              TIMESTAMPTZ,
  status                 reminder_status,
  family_member_id       UUID,
  family_member_name     TEXT,
  medical_visit_id       UUID,
  medical_test_id        UUID,
  prescription_id        UUID,
  medication_schedule_id UUID,
  is_read                BOOLEAN,
  read_at                TIMESTAMPTZ
) AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL OR NOT public.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este grupo familiar';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS reminder_id,
    r.reminder_type,
    r.title,
    r.message,
    r.remind_at,
    r.status,
    r.family_member_id,
    trim(concat_ws(' ', fm.first_name, fm.last_name)) AS family_member_name,
    r.medical_visit_id,
    r.medical_test_id,
    r.prescription_id,
    r.medication_schedule_id,
    (nr.read_at IS NOT NULL OR r.read_at IS NOT NULL OR r.status = 'read') AS is_read,
    COALESCE(nr.read_at, r.read_at) AS read_at
  FROM public.reminders r
  LEFT JOIN public.family_members fm
    ON fm.id = r.family_member_id
  LEFT JOIN public.notification_reads nr
    ON nr.reminder_id = r.id
   AND nr.user_id = v_user_id
  WHERE r.tenant_id = p_tenant_id
    AND r.status IN ('sent', 'read', 'failed')
  ORDER BY r.remind_at DESC, r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP FUNCTION IF EXISTS public.get_unread_notification_count(UUID);
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  p_tenant_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_total   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL OR NOT public.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este grupo familiar';
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM public.reminders r
  LEFT JOIN public.notification_reads nr
    ON nr.reminder_id = r.id
   AND nr.user_id = v_user_id
  WHERE r.tenant_id = p_tenant_id
    AND r.status IN ('sent', 'read', 'failed')
    AND nr.read_at IS NULL
    AND COALESCE(r.read_at IS NOT NULL OR r.status = 'read', FALSE) = FALSE;

  RETURN COALESCE(v_total, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP FUNCTION IF EXISTS public.mark_notification_as_read(UUID);
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(
  p_reminder_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_reminder_id IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.notification_reads (reminder_id, user_id, read_at)
  SELECT
    r.id,
    v_user_id,
    NOW()
  FROM public.reminders r
  WHERE r.id = p_reminder_id
    AND public.user_belongs_to_tenant(r.tenant_id)
    AND r.status IN ('sent', 'read', 'failed')
  ON CONFLICT (reminder_id, user_id)
  DO UPDATE
    SET
      read_at = EXCLUDED.read_at,
      updated_at = NOW();

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.mark_all_notifications_as_read(UUID);
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read(
  p_tenant_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL OR NOT public.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este grupo familiar';
  END IF;

  WITH due_reminders AS (
    SELECT r.id
    FROM public.reminders r
    LEFT JOIN public.notification_reads nr
      ON nr.reminder_id = r.id
     AND nr.user_id = v_user_id
    WHERE r.tenant_id = p_tenant_id
      AND r.status IN ('sent', 'read', 'failed')
      AND nr.read_at IS NULL
      AND COALESCE(r.read_at IS NOT NULL OR r.status = 'read', FALSE) = FALSE
  ), upserted AS (
    INSERT INTO public.notification_reads (reminder_id, user_id, read_at)
    SELECT id, v_user_id, NOW()
    FROM due_reminders
    ON CONFLICT (reminder_id, user_id)
    DO UPDATE
      SET
        read_at = EXCLUDED.read_at,
        updated_at = NOW()
    RETURNING reminder_id
  )
  SELECT COUNT(*)
  INTO v_count
  FROM upserted;

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.compute_visit_appointment_remind_at(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_medical_visit_appointment_reminder(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_feed(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_as_read(UUID) TO authenticated;

DO $$
DECLARE
  v_visit_id UUID;
BEGIN
  FOR v_visit_id IN
    SELECT id
    FROM public.medical_visits
    WHERE deleted_at IS NULL
      AND status::TEXT = 'scheduled'
      AND visit_date > NOW()
  LOOP
    PERFORM public.sync_medical_visit_appointment_reminder(v_visit_id);
  END LOOP;
END $$;
