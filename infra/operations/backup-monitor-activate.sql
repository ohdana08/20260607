-- Run only after the production monitor route and the Vault secret named
-- ddakfit_backup_monitor_secret have both been verified.
select cron.schedule(
  'ddakfit-backup-monitor-dispatch',
  '47 * * * *',
  $$select ddakfit_monitor_private.dispatch_backup_monitor();$$
);

select cron.schedule(
  'ddakfit-backup-monitor-reconcile',
  '*/5 * * * *',
  $$select ddakfit_monitor_private.reconcile_backup_monitor();$$
);

-- pg_cron does not remove run history automatically. Limit cleanup to these
-- three named monitor jobs so unrelated project cron evidence is preserved.
select cron.schedule(
  'ddakfit-backup-monitor-cron-history-cleanup',
  '17 3 * * *',
  $$delete from cron.job_run_details details
    using cron.job jobs
    where details.jobid = jobs.jobid
      and jobs.jobname in (
        'ddakfit-backup-monitor-dispatch',
        'ddakfit-backup-monitor-reconcile',
        'ddakfit-backup-monitor-cron-history-cleanup'
      )
      and details.end_time < clock_timestamp() - interval '30 days';$$
);
