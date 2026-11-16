-- 딱지원핏 공고 수집 표 (2026-11-16). Supabase bcc-business > SQL Editor에 전체 붙여넣고 Run.
-- 수집기(scripts/collect-programs.mts)와 lib/supabase/programs.ts가 쓰는 열과 같다.
-- 새 표만 만든다. 기존 표·데이터는 건드리지 않는다. 서버 전용 키(service_role)만 접근한다.
begin;
create table if not exists public.programs (
  id text primary key,
  source text not null,
  external_id text not null,
  title text not null,
  summary text not null default '',
  target text not null default '',
  support_field text not null default '',
  region text not null default '',
  apply_end text,
  url text not null,
  form_url text,
  last_seen_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists programs_source_open_idx on public.programs(source) where closed_at is null;
create index if not exists programs_open_deadline_idx on public.programs(apply_end asc nulls last, id) where closed_at is null;
create index if not exists programs_first_seen_idx on public.programs(first_seen_at);
-- first_seen_at은 처음 본 시각이라 바꾸지 못하게 막는다(알림의 '새 공고' 판단 기준).
create or replace function public.programs_keep_first_seen() returns trigger language plpgsql as $$
begin new.first_seen_at := old.first_seen_at; return new; end $$;
drop trigger if exists programs_keep_first_seen on public.programs;
create trigger programs_keep_first_seen before update on public.programs for each row execute function public.programs_keep_first_seen();
alter table public.programs enable row level security;
revoke all on public.programs from anon, authenticated;
grant select, insert, update on public.programs to service_role;
revoke all on function public.programs_keep_first_seen() from public, anon, authenticated;
commit;

-- 확인: 아래 결과에 programs 1줄이 보이면 성공
select table_name, (select count(*) from public.programs) as rows from information_schema.tables where table_schema='public' and table_name='programs';
