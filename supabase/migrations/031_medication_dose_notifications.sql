-- ============================================================
-- 031 -- Recordatorios de dosis de medicamentos
--
-- Sincroniza medication_schedules -> reminders(reminder_type='medication_dose')
-- para que las dosis pendientes tambien lleguen a campanita y push.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique_medication_schedule
  ON public.reminders(medication_schedule_id, reminder_type)
  WHERE reminder_type = 'medication_dose';

DROP FUNCTION IF EXISTS public.compute_medication_dose_remind_at(TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.compute_medication_dose_remind_at(
  p_scheduled_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_scheduled_at IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_scheduled_at <= v_now THEN
    RETURN v_now;
  END IF;

  IF p_scheduled_at - INTERVAL '30 minutes' > v_now THEN
    RETURN p_scheduled_at - INTERVAL '30 minutes';
  END IF;

  IF p_scheduled_at - INTERVAL '10 minutes' > v_now THEN
    RETURN p_scheduled_at - INTERVAL '10 minutes';
  END IF;

  RETURN p_scheduled_at;
END;
$$ LANGUAGE plpgsql STABLE;

DROP FUNCTION IF EXISTS public.sync_medication_schedule_reminder(UUID);
CREATE OR REPLACE FUNCTION public.sync_medication_schedule_reminder(
  p_schedule_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_schedule      public.medication_schedules%ROWTYPE;
  v_rx            public.prescriptions%ROWTYPE;
  v_reminder_id   UUID;
  v_remind_at     TIMESTAMPTZ;
  v_title         TEXT;
  v_message       TEXT;
  v_time_label    TEXT;
  v_dose_detail   TEXT;
BEGIN
  IF p_schedule_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_schedule
  FROM public.medication_schedules
  WHERE id = p_schedule_id;

  IF NOT FOUND THEN
    DELETE FROM public.reminders
    WHERE medication_schedule_id = p_schedule_id
      AND reminder_type = 'medication_dose';
    RETURN;
  END IF;

  SELECT *
  INTO v_rx
  FROM public.prescriptions
  WHERE id = v_schedule.prescription_id;

  IF NOT FOUND
    OR v_schedule.status::TEXT <> 'pending'
    OR v_schedule.scheduled_at IS NULL
    OR COALESCE(v_rx.status::TEXT, '') <> 'active' THEN
    DELETE FROM public.reminders
    WHERE medication_schedule_id = p_schedule_id
      AND reminder_type = 'medication_dose';
    RETURN;
  END IF;

  v_remind_at := public.compute_medication_dose_remind_at(v_schedule.scheduled_at);
  v_time_label := trim(to_char(v_schedule.scheduled_at AT TIME ZONE 'America/Bogota', 'HH12:MI AM'));
  v_title := format('Medicamento: %s', COALESCE(NULLIF(trim(v_rx.medication_name), ''), 'Dosis pendiente'));
  v_dose_detail := NULLIF(trim(concat_ws(' ', v_rx.dose_amount::TEXT, v_rx.dose_unit)), '');
  v_message := COALESCE(
    NULLIF(trim(concat_ws(' · ',
      NULLIF(trim(COALESCE(v_schedule.dose_label, '')), ''),
      v_dose_detail,
      format('Programado para %s', v_time_label)
    )), ''),
    'Tienes una dosis pendiente por tomar'
  );

  INSERT INTO public.reminders (
    tenant_id,
    family_id,
    family_member_id,
    prescription_id,
    medication_schedule_id,
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
    v_schedule.tenant_id,
    v_schedule.family_id,
    v_schedule.family_member_id,
    v_schedule.prescription_id,
    v_schedule.id,
    'medication_dose',
    v_title,
    v_message,
    v_remind_at,
    'pending',
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (medication_schedule_id, reminder_type) WHERE reminder_type = 'medication_dose'
  DO UPDATE
    SET
      tenant_id = EXCLUDED.tenant_id,
      family_id = EXCLUDED.family_id,
      family_member_id = EXCLUDED.family_member_id,
      prescription_id = EXCLUDED.prescription_id,
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

DROP FUNCTION IF EXISTS public.sync_prescription_medication_reminders(UUID);
CREATE OR REPLACE FUNCTION public.sync_prescription_medication_reminders(
  p_prescription_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_schedule_id UUID;
BEGIN
  IF p_prescription_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_schedule_id IN
    SELECT id
    FROM public.medication_schedules
    WHERE prescription_id = p_prescription_id
  LOOP
    PERFORM public.sync_medication_schedule_reminder(v_schedule_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.trg_sync_medication_schedule_reminder();
CREATE OR REPLACE FUNCTION public.trg_sync_medication_schedule_reminder()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reminders
    WHERE medication_schedule_id = OLD.id
      AND reminder_type = 'medication_dose';
    RETURN OLD;
  END IF;

  PERFORM public.sync_medication_schedule_reminder(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_medication_schedule_reminder ON public.medication_schedules;
DROP TRIGGER IF EXISTS trg_sync_medication_schedule_reminder_delete ON public.medication_schedules;

CREATE TRIGGER trg_sync_medication_schedule_reminder
AFTER INSERT OR UPDATE OF scheduled_at, status, prescription_id
ON public.medication_schedules
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_medication_schedule_reminder();

CREATE TRIGGER trg_sync_medication_schedule_reminder_delete
AFTER DELETE
ON public.medication_schedules
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_medication_schedule_reminder();

DROP FUNCTION IF EXISTS public.trg_sync_prescription_medication_reminders();
CREATE OR REPLACE FUNCTION public.trg_sync_prescription_medication_reminders()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.sync_prescription_medication_reminders(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_prescription_medication_reminders ON public.prescriptions;
CREATE TRIGGER trg_sync_prescription_medication_reminders
AFTER UPDATE OF medication_name, dose_amount, dose_unit, status
ON public.prescriptions
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_prescription_medication_reminders();

GRANT EXECUTE ON FUNCTION public.compute_medication_dose_remind_at(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_medication_schedule_reminder(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_prescription_medication_reminders(UUID) TO authenticated;

DO $$
DECLARE
  v_schedule_id UUID;
BEGIN
  FOR v_schedule_id IN
    SELECT ms.id
    FROM public.medication_schedules ms
    JOIN public.prescriptions rx
      ON rx.id = ms.prescription_id
    WHERE ms.status::TEXT = 'pending'
      AND rx.status::TEXT = 'active'
  LOOP
    PERFORM public.sync_medication_schedule_reminder(v_schedule_id);
  END LOOP;
END $$;
