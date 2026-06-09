create table if not exists public.registration_group_issue_delegates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  registration_group_id uuid not null references public.registration_groups(id) on delete cascade,
  active boolean not null default true,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid references public.users(id) on delete set null,
  unique (user_id, registration_group_id)
);

create index if not exists registration_group_issue_delegates_user_active_idx
  on public.registration_group_issue_delegates(user_id, active);

create index if not exists registration_group_issue_delegates_group_active_idx
  on public.registration_group_issue_delegates(registration_group_id, active);
