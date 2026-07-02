begin;

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  printer_id text not null,
  status text not null default 'pending',
  payload jsonb not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  printed_at timestamptz,
  error_message text
);

alter table public.print_jobs
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists started_at timestamptz,
  add column if not exists printed_at timestamptz,
  add column if not exists error_message text;

update public.print_jobs
set status = lower(trim(status))
where status is not null
  and status <> lower(trim(status));

update public.print_jobs
set status = case
  when status in ('done', 'complete', 'completed', 'success') then 'printed'
  when status in ('started', 'running', 'processing', 'printing') then 'printing'
  when status in ('failed', 'fail', 'chyba', 'error') then 'failed'
  when status in ('pending', 'printing', 'printed', 'failed') then status
  else 'failed'
end;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'print_jobs_status_check'
      and conrelid = 'public.print_jobs'::regclass
  ) then
    alter table public.print_jobs
      add constraint print_jobs_status_check
      check (status in ('pending', 'printing', 'printed', 'failed'));
  end if;
end $$;

create index if not exists print_jobs_pending_idx
  on public.print_jobs (printer_id, status, created_at);

create index if not exists print_jobs_created_by_idx
  on public.print_jobs (created_by, created_at desc);

alter table public.print_jobs enable row level security;

drop policy if exists print_jobs_no_direct_client_access
  on public.print_jobs;

create policy print_jobs_no_direct_client_access
  on public.print_jobs
  for all
  using (false)
  with check (false);

commit;
