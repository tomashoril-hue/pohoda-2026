delete from public.app_user_roles
where role = 'REG_GROUP_MANAGER';

alter table public.app_user_roles
  drop constraint if exists app_user_roles_role_check;

alter table public.app_user_roles
  add constraint app_user_roles_role_check
  check (role in ('ADMIN', 'PERSONALISTA', 'ADMIN_VYDAJ', 'VYDAJ', 'GROUP_CREATOR'));

create table if not exists public.registration_group_managers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  registration_group_id uuid not null references public.registration_groups(id) on delete cascade,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  created_by uuid references public.users(id) on delete set null,
  unique (user_id, registration_group_id)
);

create index if not exists registration_group_managers_user_active_idx
  on public.registration_group_managers(user_id, active);

create index if not exists registration_group_managers_group_active_idx
  on public.registration_group_managers(registration_group_id, active);
