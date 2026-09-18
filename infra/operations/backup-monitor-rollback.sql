-- Stop new monitor calls without deleting audit rows or queued alert messages.
select cron.unschedule('ddakfit-backup-monitor-dispatch')
where exists (select 1 from cron.job where jobname = 'ddakfit-backup-monitor-dispatch');

select cron.unschedule('ddakfit-backup-monitor-reconcile')
where exists (select 1 from cron.job where jobname = 'ddakfit-backup-monitor-reconcile');

select cron.unschedule('ddakfit-backup-monitor-cron-history-cleanup')
where exists (
  select 1 from cron.job
  where jobname = 'ddakfit-backup-monitor-cron-history-cleanup'
);
