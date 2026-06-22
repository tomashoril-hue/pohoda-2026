alter table public.registration_group_issue_pickup_users
  add column if not exists active boolean not null default true,
  add column if not exists removed_at timestamp with time zone,
  add column if not exists removed_by uuid references public.users(id) on delete set null,
  add column if not exists updated_at timestamp with time zone not null default now();

create or replace function public.touch_registration_group_issue_pickup_users_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_registration_group_issue_pickup_users_updated_at
  on public.registration_group_issue_pickup_users;

create trigger trg_registration_group_issue_pickup_users_updated_at
before update on public.registration_group_issue_pickup_users
for each row
execute function public.touch_registration_group_issue_pickup_users_updated_at();

create index if not exists registration_group_issue_pickup_users_issue_active_idx
  on public.registration_group_issue_pickup_users(issue_id, active, updated_at);

create index if not exists registration_group_issue_pickup_users_updated_idx
  on public.registration_group_issue_pickup_users(updated_at);
