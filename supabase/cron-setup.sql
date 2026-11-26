-- Agenda o morning-digest todo dia as 7h30 de Brasilia (10h30 UTC)
-- ANTES de rodar: troque SEU_SEGREDO_AQUI pelo mesmo valor usado em CRON_SECRET

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- remove agendamento anterior com o mesmo nome (se existir)
SELECT cron.unschedule('morning-digest')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-digest');

SELECT cron.schedule(
  'morning-digest',
  '30 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hiwrscxyclsovfbnzmwn.supabase.co/functions/v1/morning-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'SEU_SEGREDO_AQUI'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- confere se agendou
SELECT jobid, jobname, schedule, active FROM cron.job;
