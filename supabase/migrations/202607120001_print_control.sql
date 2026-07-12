begin;

create table if not exists public.print_control (
  printer_id text primary key,
  stop_requested boolean not null default false,
  requested_at timestamptz,
  requested_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.print_control enable row level security;

drop policy if exists print_control_no_direct_client_access on public.print_control;
create policy print_control_no_direct_client_access
on public.print_control
for all
using (false)
with check (false);

insert into public.print_control (printer_id, stop_requested)
values
  ('vydaj-1', false),
  ('vydaj-zurnal', false)
on conflict (printer_id) do nothing;

commit;
