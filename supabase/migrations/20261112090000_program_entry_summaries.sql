-- LOCAL DRAFT ONLY. Apply only after a separate production DB approval.
-- Existing public.programs is the collection source of truth; this side table
-- stores one durable attempt per notice and never runs a migration-time backfill.
begin;
create table if not exists public.program_entry_summaries (
  program_id text primary key references public.programs(id) on delete cascade,
  status text not null check (status in ('attempted', 'ready', 'failed')),
  source_url text not null,
  source_summary text not null,
  source_target text not null,
  who text not null,
  amount text not null,
  deadline text not null,
  description text not null,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.program_entry_summaries enable row level security;
revoke all on table public.program_entry_summaries from anon, authenticated;
grant select, insert, update, delete on table public.program_entry_summaries to service_role;
comment on table public.program_entry_summaries is 'At-most-once Haiku attempt per newly collected notice; no automatic retries or old backlog. Public cards are projected by server routes.';
commit;
