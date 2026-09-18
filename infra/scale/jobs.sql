-- Candidate schema, applied only to the isolated local lab in this task.
-- No extensions required (Postgres 17). Queue API is backend/service-role only.
begin;
create table public.scale_job_queues (
  name text primary key,
  max_running integer not null check (max_running between 1 and 100),
  max_pending integer not null check (max_pending between 1 and 10000),
  max_per_owner integer not null default 3 check (max_per_owner between 1 and 100),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_seconds integer not null default 60 check (lease_seconds between 5 and 300),
  runtime_seconds integer not null default 300 check (runtime_seconds between 10 and 900)
);
insert into public.scale_job_queues(name,max_running,max_pending) values
  ('word',20,40), ('presentation',10,20), ('collection',2,20);
create table public.scale_jobs (
  id uuid primary key default gen_random_uuid(),
  queue text not null references public.scale_job_queues(name),
  owner_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 32768),
  state text not null default 'queued' check (state in ('queued','running','succeeded','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  runtime_deadline timestamptz,
  result jsonb check (octet_length(result::text) <= 16384),
  error_code text check (error_code ~ '^[A-Z0-9_]{1,64}$'),
  unique(owner_id, queue, idempotency_key),
  check ((state = 'running') = (lease_token is not null and lease_until is not null and runtime_deadline is not null))
);
create index scale_jobs_ready on public.scale_jobs(queue,available_at,created_at,id) where state='queued';
create index scale_jobs_leases on public.scale_jobs(queue,lease_until) where state='running';
create index scale_jobs_owner on public.scale_jobs(owner_id,queue,state);
alter table public.scale_job_queues enable row level security;
alter table public.scale_jobs enable row level security;
revoke all on public.scale_job_queues, public.scale_jobs from public;

create function public.scale_enqueue(p_queue text, p_owner uuid, p_key text, p_payload jsonb)
returns public.scale_jobs language plpgsql security invoker set search_path='' as $$
declare cfg public.scale_job_queues; job public.scale_jobs;
begin
  if p_owner is null or p_key is null or length(p_key) not between 1 and 128 or
     p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then
    raise exception 'INVALID_JOB' using errcode='22023';
  end if;
  -- A short per-queue transaction serializes capacity decisions, not job execution.
  select * into strict cfg from public.scale_job_queues where name=p_queue for update;
  select * into job from public.scale_jobs where queue=p_queue and owner_id=p_owner and idempotency_key=p_key;
  if found then
    if job.payload <> p_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return job;
  end if;
  if (select count(*) from public.scale_jobs where queue=p_queue and state in ('queued','running')) >= cfg.max_pending then
    raise exception 'QUEUE_FULL' using errcode='53300';
  end if;
  if (select count(*) from public.scale_jobs where queue=p_queue and owner_id=p_owner and state in ('queued','running')) >= cfg.max_per_owner then
    raise exception 'OWNER_BUSY' using errcode='53300';
  end if;
  insert into public.scale_jobs(queue,owner_id,idempotency_key,payload) values(p_queue,p_owner,p_key,p_payload) returning * into job;
  return job;
end $$;

create function public.scale_claim(p_queue text)
returns setof public.scale_jobs language plpgsql security invoker set search_path='' as $$
declare cfg public.scale_job_queues; picked uuid; t timestamptz := clock_timestamp();
begin
  select * into strict cfg from public.scale_job_queues where name=p_queue for update;
  t := clock_timestamp();
  update public.scale_jobs set state='dead',error_code='LEASE_EXHAUSTED',lease_token=null,lease_until=null,runtime_deadline=null,updated_at=t
    where queue=p_queue and state='running' and lease_until<=t and attempts>=cfg.max_attempts;
  if (select count(*) from public.scale_jobs where queue=p_queue and state='running' and lease_until>t) >= cfg.max_running then return; end if;
  select id into picked from public.scale_jobs
    where queue=p_queue and attempts<cfg.max_attempts
      and ((state='queued' and available_at<=t) or (state='running' and lease_until<=t))
    order by available_at,created_at,id for update skip locked limit 1;
  if picked is null then return; end if;
  return query update public.scale_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),
    lease_until=t+make_interval(secs=>least(cfg.lease_seconds,cfg.runtime_seconds)),
    runtime_deadline=t+make_interval(secs=>cfg.runtime_seconds),updated_at=t
    where id=picked returning *;
end $$;

create function public.scale_heartbeat(p_id uuid,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; t timestamptz := clock_timestamp();
begin
  update public.scale_jobs j set lease_until=least(j.runtime_deadline,t+make_interval(secs=>q.lease_seconds)),updated_at=t
    from public.scale_job_queues q where q.name=j.queue and j.id=p_id and j.lease_token=p_token
    and j.state='running' and j.lease_until>clock_timestamp() and j.runtime_deadline>clock_timestamp();
  get diagnostics n=row_count; return n=1;
end $$;

create function public.scale_complete(p_id uuid,p_token uuid,p_result jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; t timestamptz := clock_timestamp();
begin
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>16384 then
    raise exception 'INVALID_RESULT' using errcode='22023';
  end if;
  update public.scale_jobs set state='succeeded',result=p_result,lease_token=null,lease_until=null,runtime_deadline=null,updated_at=t
    where id=p_id and state='running' and lease_token=p_token and lease_until>clock_timestamp() and runtime_deadline>clock_timestamp();
  get diagnostics n=row_count; return n=1;
end $$;

create function public.scale_fail(p_id uuid,p_token uuid,p_code text,p_retryable boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; t timestamptz := clock_timestamp();
begin
  if p_code is null or p_code !~ '^[A-Z0-9_]{1,64}$' then raise exception 'INVALID_ERROR_CODE' using errcode='22023'; end if;
  update public.scale_jobs j set
    state=case when p_retryable and j.attempts<q.max_attempts then 'queued' else 'dead' end,
    available_at=t+make_interval(secs=>least(300,5*power(2,j.attempts-1)::integer)),
    error_code=p_code,lease_token=null,lease_until=null,runtime_deadline=null,updated_at=t
    from public.scale_job_queues q where j.queue=q.name and j.id=p_id and j.state='running'
    and j.lease_token=p_token and j.lease_until>clock_timestamp() and j.runtime_deadline>clock_timestamp();
  get diagnostics n=row_count; return n=1;
end $$;

revoke all on function public.scale_enqueue(text,uuid,text,jsonb), public.scale_claim(text),
  public.scale_heartbeat(uuid,uuid), public.scale_complete(uuid,uuid,jsonb), public.scale_fail(uuid,uuid,text,boolean) from public;
-- Supabase roles exist there; a plain local Postgres lab does not need them.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if exists(select from pg_roles where rolname=r) then
      execute format('revoke all on public.scale_jobs, public.scale_job_queues from %I',r);
      execute format('revoke all on function public.scale_enqueue(text,uuid,text,jsonb), public.scale_claim(text), public.scale_heartbeat(uuid,uuid), public.scale_complete(uuid,uuid,jsonb), public.scale_fail(uuid,uuid,text,boolean) from %I',r);
    end if;
  end loop;
  if exists(select from pg_roles where rolname='service_role') then
    grant select,insert,update on public.scale_jobs to service_role;
    grant select,update on public.scale_job_queues to service_role;
    grant execute on function public.scale_enqueue(text,uuid,text,jsonb), public.scale_claim(text),
      public.scale_heartbeat(uuid,uuid), public.scale_complete(uuid,uuid,jsonb), public.scale_fail(uuid,uuid,text,boolean) to service_role;
  end if;
end $$;
commit;
