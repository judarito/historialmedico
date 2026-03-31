-- ============================================================
-- 029 -- Endurecer notificaciones: realtime del inbox/badge
--
-- Asegura que reminders y notification_reads publiquen cambios
-- hacia supabase_realtime para que el badge de la campanita
-- se refresque sin abrir la pantalla.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'reminders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.reminders;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notification_reads'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_reads;
    END IF;
  END IF;
END $$;
