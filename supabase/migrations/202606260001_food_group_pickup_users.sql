create table if not exists public.group_pickup_users (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_pickup_users_user_idx
  on public.group_pickup_users(user_id);

create index if not exists group_pickup_users_group_active_idx
  on public.group_pickup_users(group_id, active);

create or replace function public.touch_group_pickup_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_group_pickup_users_updated_at
  on public.group_pickup_users;

create trigger trg_group_pickup_users_updated_at
before update on public.group_pickup_users
for each row
execute function public.touch_group_pickup_users_updated_at();
