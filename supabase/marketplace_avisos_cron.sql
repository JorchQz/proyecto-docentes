-- =============================================================================
-- Aviso diario de pedidos a la medida vencidos (9.c del documento)
-- =============================================================================
--
-- pg_cron llama todos los dias a las 8:00 (hora del centro = 14:00 UTC) a la
-- Edge Function avisos-pedidos, que manda un correo a MAIL_ADMIN solo si hay
-- pedidos vencidos o por vencer en 24 h.
--
-- El secreto que autoriza la llamada (CRON_SECRET, tambien en los secretos de
-- las Edge Functions) vive en Vault con el nombre 'cron_secret'; se guarda
-- aparte, nunca en este archivo:
--   select vault.create_secret('<valor>', 'cron_secret');
--
-- Idempotente: reprogramar con el mismo nombre reemplaza el job.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'avisos-pedidos-diario';

select cron.schedule(
  'avisos-pedidos-diario',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://cluvaxxqvhtxxiwctpnl.supabase.co/functions/v1/avisos-pedidos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
