alter table ddakfit_monitor_private.backup_monitor_dispatches
  drop constraint if exists backup_monitor_dispatches_outcome_check;
update ddakfit_monitor_private.backup_monitor_dispatches
set outcome = 'backup_detected'
where outcome = 'backup_alerted';
alter table ddakfit_monitor_private.backup_monitor_dispatches
  add constraint backup_monitor_dispatches_outcome_check
  check (outcome in ('pending', 'healthy', 'backup_detected', 'auth_failed', 'monitor_unavailable', 'response_missing'));

create or replace function ddakfit_monitor_private.classify_backup_monitor_response(
  response_status integer,
  response_content text
)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  payload jsonb;
  response_reason text;
  response_id text;
begin
  if response_status in (401, 403) then return 'auth_failed'; end if;
  if response_status not in (200, 503) then return 'monitor_unavailable'; end if;
  begin
    payload := response_content::jsonb;
  exception when others then
    return 'monitor_unavailable';
  end;
  if jsonb_typeof(payload) <> 'object' then return 'monitor_unavailable'; end if;
  response_reason := payload->>'reason';
  response_id := payload->>'requestId';
  if response_id is null or response_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'monitor_unavailable';
  end if;
  if response_status = 200 and payload->'ok' = 'true'::jsonb
    and response_reason in ('fresh', 'fresh_pending') then return 'healthy'; end if;
  if response_status = 503 and payload->'ok' = 'false'::jsonb
    and response_reason in ('run_missing', 'run_stale', 'run_unverified', 'job_unverified',
      'artifact_unverified', 'github_unavailable', 'github_invalid', 'github_timeout') then
    return 'backup_detected';
  end if;
  return 'monitor_unavailable';
end;
$$;

create or replace function ddakfit_monitor_private.reconcile_backup_monitor()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, ddakfit_monitor_private
as $$
declare
  reconciled integer := 0;
begin
  with changed as (
    update ddakfit_monitor_private.backup_monitor_dispatches dispatch
    set completed_at = response.created,
        status_code = response.status_code,
        outcome = case
          when coalesce(response.timed_out, false) or response.error_msg is not null then 'monitor_unavailable'
          else ddakfit_monitor_private.classify_backup_monitor_response(response.status_code, response.content)
        end
    from net._http_response response
    where dispatch.request_id = response.id
      and dispatch.outcome = 'pending'
    returning 1
  )
  select count(*) into reconciled from changed;

  update ddakfit_monitor_private.backup_monitor_dispatches
  set completed_at = clock_timestamp(), outcome = 'response_missing'
  where outcome = 'pending' and requested_at < clock_timestamp() - interval '20 minutes';

  delete from ddakfit_monitor_private.backup_monitor_dispatches
  where requested_at < clock_timestamp() - interval '30 days';
  return reconciled;
end;
$$;

revoke all on function ddakfit_monitor_private.classify_backup_monitor_response(integer, text)
  from public, anon, authenticated, service_role, ddakfit_backup_preview;
revoke all on function ddakfit_monitor_private.reconcile_backup_monitor()
  from public, anon, authenticated, service_role, ddakfit_backup_preview;
