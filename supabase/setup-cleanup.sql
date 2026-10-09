-- Enable Cron (pg_cron) and pg_net in the Supabase Dashboard first.
-- Create these secrets in Vault before running this file:
-- checklist_project_url, checklist_publishable_key, checklist_cleanup_secret.
-- The cleanup secret must match CHECKLIST_CLEANUP_SECRET in Edge Function Secrets.
-- Re-running updates the same job rather than creating a duplicate.
select cron.schedule(
  'checklist-files-cleanup',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='checklist_project_url') || '/functions/v1/checklist-files',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='checklist_publishable_key'),
      'x-cleanup-secret',(select decrypted_secret from vault.decrypted_secrets where name='checklist_cleanup_secret')
    ),
    body := '{"action":"cleanup"}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
