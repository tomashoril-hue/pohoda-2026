alter table public.registration_group_managers
  add column if not exists valid_after timestamp with time zone not null default now();

update public.registration_group_managers
set valid_after = coalesce(valid_after, created_at, now())
where valid_after is null;

create index if not exists registration_group_managers_valid_lookup_idx
  on public.registration_group_managers(user_id, registration_group_id, active, valid_after);
