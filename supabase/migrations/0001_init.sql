-- Zedu Auto Tester — initial schema (run in the Supabase SQL editor or via supabase db push)
-- The backend talks to these tables with the service_role key; RLS is enabled
-- with no policies, so the anon key can never read or write them directly.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_url text,
  branch text not null default 'main',
  staging_url text,
  alert_channel text,
  api_key_hash text not null unique, -- sha256 of the project API key; the raw key is shown once
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  branch text not null default 'main',
  commit_sha text,
  commit_message text,
  trigger text not null default 'manual', -- manual | push | pull_request | nightly | re-run
  environment text not null default 'staging',
  status text not null default 'running', -- running | completed | error
  verdict text not null default 'running', -- running | ready | ready_with_warnings | not_ready | error
  total int not null default 0,
  passed int not null default 0,
  failed int not null default 0,
  flaky int not null default 0,
  skipped int not null default 0,
  duration_ms bigint,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists runs_project_created_idx on public.runs (project_id, created_at desc);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  name text not null,
  feature text,
  priority text not null default 'P0', -- P0 | P1 | P2
  status text not null, -- passed | failed | flaky | skipped | error
  duration_ms bigint,
  error text,
  screenshot_path text, -- path inside the private "evidence" storage bucket
  created_at timestamptz not null default now()
);

create index if not exists test_results_run_idx on public.test_results (run_id);

-- Lock everything down: only the service role (backend) accesses these tables.
alter table public.projects enable row level security;
alter table public.runs enable row level security;
alter table public.test_results enable row level security;

-- Private bucket for failure screenshots; the backend issues signed URLs.
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

-- No public read/write policies on evidence: only the service role can access it.
