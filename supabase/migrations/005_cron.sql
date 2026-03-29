-- ============================================================
-- Family Health Tracker — Cron Jobs con pg_cron
-- Migration: 005_cron.sql
-- Requiere: extensión pg_cron habilitada en Supabase
-- ============================================================

-- Habilitar pg_cron (hacer en Supabase Dashboard → Extensions)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- JOB 1: Enviar notificaciones cada 5 minutos
-- Llama a la Edge Function send-notifications
-- ============================================================
SELECT cron.schedule(
    'send-medication-reminders',
    '*/5 * * * *',   -- cada 5 minutos
    $$
    SELECT net.http_post(
        url:='https://lrjuwkkugqijahqjgcmb.supabase.co/functions/v1/send-notifications',
        headers:='{"Content-Type": "application/json", "x-internal-secret": "' ||
                  current_setting('app.internal_secret', true) || '"}'::jsonb,
        body:='{}'::jsonb
    );
    $$
);

-- ============================================================
-- JOB 2: Marcar dosis atrasadas (más de 2h sin tomar)
-- Corre cada hora
-- ============================================================
SELECT cron.schedule(
    'mark-overdue-doses',
    '0 * * * *',    -- cada hora en punto
    $$
    UPDATE medication_schedules
    SET status = 'late'
    WHERE status = 'pending'
      AND scheduled_at < NOW() - INTERVAL '2 hours';
    $$
);

-- ============================================================
-- JOB 3: Limpiar recordatorios enviados hace más de 30 días
-- Corre a las 3am todos los días
-- ============================================================
SELECT cron.schedule(
    'cleanup-old-reminders',
    '0 3 * * *',    -- 3am diario
    $$
    DELETE FROM reminders
    WHERE is_sent = TRUE
      AND sent_at < NOW() - INTERVAL '30 days';
    $$
);

-- ============================================================
-- JOB 4: Desactivar medicamentos cuyo end_date ya pasó
-- Corre a medianoche todos los días
-- ============================================================
SELECT cron.schedule(
    'deactivate-expired-medications',
    '0 0 * * *',    -- medianoche diario
    $$
    UPDATE prescription_medications
    SET is_active = FALSE
    WHERE is_active = TRUE
      AND end_date IS NOT NULL
      AND end_date < CURRENT_DATE;
    $$
);
