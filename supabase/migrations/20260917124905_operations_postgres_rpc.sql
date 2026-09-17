-- Dedicated, capability-scoped operations storage. Provision scope/admin separately.
begin;
do $$ begin
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'Required pg_catalog.sha256(bytea) is unavailable';
  end if;
end $$;

create schema ddakfit_operations_private;
revoke all on schema ddakfit_operations_private from public, anon, authenticated, service_role;
create table ddakfit_operations_private.scopes (
  scope_id text primary key check (scope_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  secret_hash bytea not null check (octet_length(secret_hash) = 32)
);
create table ddakfit_operations_private.operator_allowlist (
  scope_id text not null references ddakfit_operations_private.scopes(scope_id),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (scope_id, user_id)
);
create table ddakfit_operations_private.months (
  scope_id text not null references ddakfit_operations_private.scopes(scope_id),
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  revision bigint not null check (revision between 1 and 1000000000001),
  state jsonb not null,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (scope_id, month),
  constraint state_revision_matches check ((
    jsonb_typeof(state) = 'object' and
    state -> 'revision' = to_jsonb(revision) and
    state #>> '{goal,month}' = month
  ) is true)
);
alter table ddakfit_operations_private.scopes enable row level security;
alter table ddakfit_operations_private.operator_allowlist enable row level security;
alter table ddakfit_operations_private.months enable row level security;
revoke all on all tables in schema ddakfit_operations_private from public, anon, authenticated, service_role;

-- Pure validators live outside the exposed API schema. Missing/JSON-null fields
-- return false rather than relying on SQL CHECK's acceptance of NULL.
create function ddakfit_operations_private.has_keys(v jsonb, keys text[])
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'object' then return false; end if;
  return (v ?& keys) and (select count(*) from jsonb_object_keys(v)) = cardinality(keys);
end $$;
create function ddakfit_operations_private.valid_integer(v jsonb, maximum numeric, minimum numeric default 0)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[0-9]+$' then return false; end if;
  return (v::text)::numeric between minimum and maximum;
end $$;
create function ddakfit_operations_private.valid_text(v jsonb, maximum integer, minimum integer default 0)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'string' then return false; end if;
  return char_length(v #>> '{}') <= maximum and char_length(btrim(v #>> '{}')) >= minimum;
end $$;
create function ddakfit_operations_private.valid_date(v jsonb, p_month text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare value text := v #>> '{}';
begin
  if jsonb_typeof(v) is distinct from 'string' or value !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or left(value, 7) <> p_month then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when datetime_field_overflow or invalid_datetime_format then return false;
end $$;

create function ddakfit_operations_private.valid_state(p_month text, p_revision bigint, v jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  item jsonb; goal jsonb; field text; previous_date text := ''; last_audit jsonb;
  today text := to_char(current_timestamp at time zone 'Asia/Seoul', 'YYYY-MM-DD');
begin
  if not ddakfit_operations_private.has_keys(v, array['schemaVersion','revision','goal','snapshots','videos','audit']) or
    octet_length(v::text) > 1048576 or v -> 'schemaVersion' is distinct from '1'::jsonb or
    v -> 'revision' is distinct from to_jsonb(p_revision) or
    jsonb_typeof(v -> 'snapshots') is distinct from 'array' or
    jsonb_typeof(v -> 'videos') is distinct from 'array' or
    jsonb_typeof(v -> 'audit') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v -> 'snapshots') > 31 or jsonb_array_length(v -> 'videos') > 100 or
    jsonb_array_length(v -> 'audit') not between 1 and 100 then return false; end if;
  goal := v -> 'goal';
  if not ddakfit_operations_private.has_keys(goal, array['month','startDate','deadline','targetKrw','plannedVideos','wordPriceKrw']) or
    goal -> 'month' is distinct from to_jsonb(p_month) or
    not ddakfit_operations_private.valid_date(goal -> 'startDate', p_month) or
    not ddakfit_operations_private.valid_date(goal -> 'deadline', p_month) or
    goal ->> 'startDate' > goal ->> 'deadline' or
    not ddakfit_operations_private.valid_integer(goal -> 'targetKrw', 1000000000000, 1) or
    not ddakfit_operations_private.valid_integer(goal -> 'plannedVideos', 1000, 1) or
    not ddakfit_operations_private.valid_integer(goal -> 'wordPriceKrw', 100000000, 1) then return false; end if;
  for item in select value from jsonb_array_elements(v -> 'snapshots') loop
    if not ddakfit_operations_private.has_keys(item, array['asOf','grossKrw','refundsKrw','wordOrders','bundleOrders','presentationOrders','publishedVideos','views','siteVisits','attributedOrders','attributedNetKrw','note']) or
      not ddakfit_operations_private.valid_date(item -> 'asOf', p_month) or
      item ->> 'asOf' > today or item ->> 'asOf' <= previous_date or
      not ddakfit_operations_private.valid_text(item -> 'note', 300) then return false; end if;
    previous_date := item ->> 'asOf';
    foreach field in array array['grossKrw','refundsKrw','wordOrders','bundleOrders','presentationOrders'] loop
      if not ddakfit_operations_private.valid_integer(item -> field, 1000000000000) then return false; end if;
    end loop;
    if not ddakfit_operations_private.valid_integer(item -> 'publishedVideos', 1000) then return false; end if;
    foreach field in array array['views','siteVisits','attributedOrders','attributedNetKrw'] loop
      if (item -> field = 'null'::jsonb or ddakfit_operations_private.valid_integer(item -> field, 1000000000000)) is not true then return false; end if;
    end loop;
    if (item ->> 'refundsKrw')::numeric > (item ->> 'grossKrw')::numeric or
      (item ->> 'attributedNetKrw')::numeric > (item ->> 'grossKrw')::numeric - (item ->> 'refundsKrw')::numeric or
      (item ->> 'attributedOrders')::numeric > (item ->> 'wordOrders')::numeric + (item ->> 'bundleOrders')::numeric + (item ->> 'presentationOrders')::numeric then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(v -> 'videos') loop
    if not ddakfit_operations_private.has_keys(item, array['id','title','plannedDate','product','status','url','views24h','views72h']) or
      not ddakfit_operations_private.valid_text(item -> 'id', 64, 1) or (item ->> 'id') !~ '^[a-zA-Z0-9_-]{1,64}$' or
      not ddakfit_operations_private.valid_text(item -> 'title', 120, 1) or
      not ddakfit_operations_private.valid_date(item -> 'plannedDate', p_month) or
      not ddakfit_operations_private.valid_text(item -> 'product', 20, 1) or (item ->> 'product') not in ('word','bundle','presentation') or
      not ddakfit_operations_private.valid_text(item -> 'status', 20, 1) or (item ->> 'status') not in ('planned','ready','published') or
      not ddakfit_operations_private.valid_text(item -> 'url', 500) then return false; end if;
    if (item ->> 'status' = 'published' and item ->> 'url' = '') or
      (item ->> 'url' <> '' and ((item ->> 'url') !~* '^https://(youtube\.com|www\.youtube\.com|m\.youtube\.com|youtu\.be)(:[0-9]{1,5})?([/?#]|$)' or (item ->> 'url') ~ '[[:cntrl:]]')) then return false; end if;
    foreach field in array array['views24h','views72h'] loop
      if (item -> field = 'null'::jsonb or ddakfit_operations_private.valid_integer(item -> field, 1000000000000)) is not true then return false; end if;
    end loop;
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(v -> 'videos') as video_rows(value)
    group by video_rows.value ->> 'id'
    having count(*) > 1
  ) then return false; end if;
  -- Only the last action/key is accepted. All audit identity, time, revision and
  -- prior history are replaced with database-authoritative values below.
  last_audit := v #> '{audit,-1}';
  if not ddakfit_operations_private.has_keys(last_audit, array['revision','kind','key','actorId','at']) or
    not ddakfit_operations_private.valid_text(last_audit -> 'kind', 20, 1) or
    (last_audit ->> 'kind') not in ('goal','snapshot','video') or
    not ddakfit_operations_private.valid_text(last_audit -> 'key', 64, 1) then return false; end if;
  if last_audit ->> 'kind' = 'goal' and last_audit ->> 'key' <> p_month then return false; end if;
  if last_audit ->> 'kind' = 'snapshot' and not exists (
    select 1 from jsonb_array_elements(v -> 'snapshots') as snapshot_rows(value)
    where snapshot_rows.value ->> 'asOf' = last_audit ->> 'key'
  ) then return false; end if;
  if last_audit ->> 'kind' = 'video' and not exists (
    select 1 from jsonb_array_elements(v -> 'videos') as video_rows(value)
    where video_rows.value ->> 'id' = last_audit ->> 'key'
  ) then return false; end if;
  return true;
end $$;

create function ddakfit_operations_private.require_operator(p_scope text, p_capability text)
returns uuid language plpgsql stable set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or p_scope is null or p_scope !~ '^[a-z][a-z0-9_-]{0,63}$' or
    p_capability is null or p_capability !~ '^[A-Za-z0-9_-]{43,128}$' or not exists (
      select 1 from ddakfit_operations_private.scopes s
      join ddakfit_operations_private.operator_allowlist a using (scope_id)
      where s.scope_id = p_scope and a.user_id = actor and
        s.secret_hash = pg_catalog.sha256(pg_catalog.convert_to(p_capability, 'UTF8'))
    ) then raise exception using errcode = '42501', message = 'Operations access denied'; end if;
  return actor;
end $$;

create function public.ddakfit_operations_read(p_scope text, p_capability text, p_month text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform ddakfit_operations_private.require_operator(p_scope, p_capability);
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'Invalid operations month';
  end if;
  select state into result from ddakfit_operations_private.months where scope_id = p_scope and month = p_month;
  return result;
end $$;

create function public.ddakfit_operations_compare_and_set(
  p_scope text, p_capability text, p_month text, p_expected_revision bigint, p_next jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '500ms' as $$
declare actor uuid; stored jsonb; audit_entry jsonb; initial_state jsonb;
begin
  actor := ddakfit_operations_private.require_operator(p_scope, p_capability);
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or
    p_expected_revision is null or p_expected_revision < 0 or p_expected_revision > 1000000000000 then
    raise exception using errcode = '22023', message = 'Invalid operations revision';
  end if;
  if ddakfit_operations_private.valid_state(p_month, p_expected_revision + 1, p_next) is not true then
    raise exception using errcode = '22023', message = 'Invalid operations state';
  end if;
  audit_entry := jsonb_build_object('revision', p_expected_revision + 1,
    'kind', p_next #>> '{audit,-1,kind}', 'key', p_next #>> '{audit,-1,key}',
    'actorId', actor::text, 'at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  initial_state := jsonb_set(p_next, '{audit}', jsonb_build_array(audit_entry));
  if p_expected_revision = 0 then
    insert into ddakfit_operations_private.months (scope_id, month, revision, state, updated_by)
    values (p_scope, p_month, 1, initial_state, actor)
    on conflict (scope_id, month) do nothing
    returning state into stored;
  else
    update ddakfit_operations_private.months m
    set revision = p_expected_revision + 1,
      state = jsonb_set(p_next, '{audit}',
        (case when jsonb_array_length(m.state -> 'audit') >= 100 then (m.state -> 'audit') - 0 else m.state -> 'audit' end) || jsonb_build_array(audit_entry)),
      updated_by = actor, updated_at = now()
    where m.scope_id = p_scope and m.month = p_month and m.revision = p_expected_revision
    returning state into stored;
  end if;
  return stored;
end $$;

revoke all on all functions in schema ddakfit_operations_private from public, anon, authenticated, service_role;
revoke all on function public.ddakfit_operations_read(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ddakfit_operations_compare_and_set(text, text, text, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.ddakfit_operations_read(text, text, text) to authenticated;
grant execute on function public.ddakfit_operations_compare_and_set(text, text, text, bigint, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
