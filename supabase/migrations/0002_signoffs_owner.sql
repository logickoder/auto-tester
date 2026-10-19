-- Auto Tester — 0002: test owners (FR-20) and release sign-off (FR-26/27)
-- Run after 0001_init.sql in the Supabase SQL editor.

alter table public.test_results add column if not exists owner text;

create table if not exists public.signoffs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  decision text not null check (decision in ('approve', 'block')),
  comment text,
  override_reason text, -- the API requires this when approving a Not Ready run (FR-27)
  decided_by_email text not null,
  decided_by_id text,
  created_at timestamptz not null default now()
);

create index if not exists signoffs_run_idx on public.signoffs (run_id, created_at desc);

-- Lock it down like the other tables: only the service role (backend) accesses it.
alter table public.signoffs enable row level security;

-- Optional — NFR "delete evidence after 14 days".
-- Database -> Extensions -> enable pg_cron, then run this once:
-- select cron.schedule('evidence-retention', '30 3 * * *',
--   $$delete from storage.objects
--     where bucket_id = 'evidence' and created_at < now() - interval '14 days'$$);
