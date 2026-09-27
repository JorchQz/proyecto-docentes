-- =============================================================================
-- Mi Salón b22: programación de los avisos por correo (spec 7)
-- =============================================================================
--
-- pg_cron llama CADA HORA a la Edge Function avisos-mi-salon. La función solo envía entre las
-- 8:00 y las 21:00 (hora del centro), solo con Mi Salón abierto, y cada aviso una sola vez por
-- cuenta (mi_salon_correos), así que correr de más no repite nada. Cada hora sirve para que el
-- recordatorio de OXXO salga cerca de las 24 horas y para repartir los envíos (tope por corrida).
--
-- NO se aplicó en el proyecto de pruebas (ahí no están pg_cron ni pg_net, ni los secretos).
-- En producción, con el OK de Jorge:
--   1. Secreto de las Edge Functions: CRON_SECRET (el mismo de avisos-pedidos si ya existe).
--   2. En Vault, con el nombre 'cron_secret' (si no está ya, por marketplace_avisos_cron.sql):
--        select vault.create_secret('<valor>', 'cron_secret');
--   3. Correr este archivo en el editor SQL de producción.
-- Idempotente: reprogramar con el mismo nombre reemplaza el job.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'avisos-mi-salon-hora';

select cron.schedule(
  'avisos-mi-salon-hora',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://cluvaxxqvhtxxiwctpnl.supabase.co/functions/v1/avisos-mi-salon',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
