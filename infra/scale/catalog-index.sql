-- Candidate operational index; review EXPLAIN against real data before applying.
-- Run outside a transaction. No production DDL was applied in this task.
create index concurrently if not exists programs_open_deadline_idx
  on public.programs(apply_end asc nulls last, id)
  where closed_at is null;
