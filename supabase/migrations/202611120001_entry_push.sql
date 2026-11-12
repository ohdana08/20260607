-- LOCAL ARTIFACT ONLY. Apply only after separate production approval.
-- Uses the existing programs.first_seen_at; do not backfill old announcements as new.
begin;
create schema ddakfit_entry_push_private;
revoke all on schema ddakfit_entry_push_private from public, anon, authenticated, service_role;
create table ddakfit_entry_push_private.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  keys jsonb not null check (jsonb_typeof(keys) = 'object'),
  conditions jsonb not null check (jsonb_typeof(conditions) = 'object'),
  consent_version text not null default '2026-11-12',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entry_push_user on ddakfit_entry_push_private.subscriptions(user_id);
create table ddakfit_entry_push_private.delivery_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('daily','weekly')),
  outcome text not null default 'claimed' check (outcome in ('claimed','accepted','failed','gone')),
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create table ddakfit_entry_push_private.cursors (
  day date not null, kind text not null check (kind in ('daily','weekly')), user_id uuid not null,
  primary key (day,kind)
);
alter table ddakfit_entry_push_private.subscriptions enable row level security;
alter table ddakfit_entry_push_private.delivery_days enable row level security;
alter table ddakfit_entry_push_private.cursors enable row level security;
revoke all on all tables in schema ddakfit_entry_push_private from public, anon, authenticated, service_role;

create function public.entry_push_save(p_user_id uuid, p_endpoint text, p_keys jsonb, p_conditions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 9431));
  if not exists (select 1 from ddakfit_entry_push_private.subscriptions where endpoint=p_endpoint and user_id=p_user_id)
     and (select count(*) from ddakfit_entry_push_private.subscriptions where user_id=p_user_id) >= 5 then
    raise exception 'subscription_limit';
  end if;
  insert into ddakfit_entry_push_private.subscriptions(user_id,endpoint,keys,conditions)
  values(p_user_id,p_endpoint,p_keys,p_conditions)
  on conflict(endpoint) do update set keys=excluded.keys,conditions=excluded.conditions,updated_at=now()
    where ddakfit_entry_push_private.subscriptions.user_id=excluded.user_id;
  if not found then raise exception 'endpoint_owned'; end if;
  -- Conditions describe the account, not a stale individual device.
  update ddakfit_entry_push_private.subscriptions set conditions=p_conditions where user_id=p_user_id;
end $$;
create function public.entry_push_status(p_user_id uuid)
returns table(conditions jsonb) language sql security definer set search_path = '' as $$
  select conditions from ddakfit_entry_push_private.subscriptions where user_id=p_user_id order by updated_at desc,id desc limit 1;
$$;
create function public.entry_push_remove(p_user_id uuid, p_endpoint text default null)
returns void language sql security definer set search_path = '' as $$
  delete from ddakfit_entry_push_private.subscriptions where user_id=p_user_id and (p_endpoint is null or endpoint=p_endpoint);
$$;
create function public.entry_push_users(p_after uuid, p_limit integer)
returns table(user_id uuid) language sql security definer set search_path = '' as $$
  select distinct user_id from ddakfit_entry_push_private.subscriptions where p_after is null or user_id>p_after order by user_id limit least(greatest(p_limit,1),100);
$$;
create function public.entry_push_subscriptions(p_user_id uuid)
returns setof ddakfit_entry_push_private.subscriptions language sql security definer set search_path = '' as $$
  select * from ddakfit_entry_push_private.subscriptions where user_id=p_user_id order by updated_at desc,id desc limit 5;
$$;
create function public.entry_push_claim(p_user_id uuid, p_day date, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_day <> (now() at time zone 'Asia/Seoul')::date then return false; end if;
  if not exists (select 1 from ddakfit_entry_push_private.subscriptions where user_id=p_user_id) then return false; end if;
  insert into ddakfit_entry_push_private.delivery_days(user_id,day,kind) values(p_user_id,p_day,p_kind) on conflict(user_id,day) do nothing;
  return found;
end $$;
create function public.entry_push_finish(p_user_id uuid, p_day date, p_outcome text)
returns void language sql security definer set search_path = '' as $$
  update ddakfit_entry_push_private.delivery_days set outcome=p_outcome where user_id=p_user_id and day=p_day and outcome='claimed';
$$;
create function public.entry_push_revoke(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from ddakfit_entry_push_private.subscriptions where id=p_id;
$$;
create function public.entry_push_cursor(p_day date, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cursor_id uuid;
begin
  -- Minimum audit retention; no endpoint/key payload in the delivery history.
  delete from ddakfit_entry_push_private.delivery_days where day < (now() at time zone 'Asia/Seoul')::date - 35;
  delete from ddakfit_entry_push_private.cursors where day < (now() at time zone 'Asia/Seoul')::date - 35;
  select user_id into cursor_id from ddakfit_entry_push_private.cursors where day=p_day and kind=p_kind;
  return cursor_id;
end $$;
create function public.entry_push_advance(p_day date, p_kind text, p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into ddakfit_entry_push_private.cursors(day,kind,user_id) values(p_day,p_kind,p_user_id)
  on conflict(day,kind) do update set user_id=greatest(ddakfit_entry_push_private.cursors.user_id,excluded.user_id);
$$;

-- Explicit grants: anon/authenticated cannot read keys or invoke privileged RPCs.
revoke all on function public.entry_push_save(uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.entry_push_status(uuid) from public,anon,authenticated;
revoke all on function public.entry_push_remove(uuid,text) from public,anon,authenticated;
revoke all on function public.entry_push_users(uuid,integer) from public,anon,authenticated;
revoke all on function public.entry_push_subscriptions(uuid) from public,anon,authenticated;
revoke all on function public.entry_push_claim(uuid,date,text) from public,anon,authenticated;
revoke all on function public.entry_push_finish(uuid,date,text) from public,anon,authenticated;
revoke all on function public.entry_push_revoke(uuid) from public,anon,authenticated;
revoke all on function public.entry_push_cursor(date,text) from public,anon,authenticated;
revoke all on function public.entry_push_advance(date,text,uuid) from public,anon,authenticated;
grant execute on function public.entry_push_save(uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.entry_push_status(uuid) to service_role;
grant execute on function public.entry_push_remove(uuid,text) to service_role;
grant execute on function public.entry_push_users(uuid,integer) to service_role;
grant execute on function public.entry_push_subscriptions(uuid) to service_role;
grant execute on function public.entry_push_claim(uuid,date,text) to service_role;
grant execute on function public.entry_push_finish(uuid,date,text) to service_role;
grant execute on function public.entry_push_revoke(uuid) to service_role;
grant execute on function public.entry_push_cursor(date,text) to service_role;
grant execute on function public.entry_push_advance(date,text,uuid) to service_role;
commit;
