create table if not exists public.registration_group_issues (
  id uuid primary key default gen_random_uuid(),
  registration_group_id uuid not null references public.registration_groups(id) on delete restrict,
  title text not null,
  datum date not null,
  typ_jedla text not null,
  status text not null default 'READY',
  valid_after timestamp with time zone,
  created_by uuid references public.users(id) on delete set null,
  created_by_access text not null default 'MANAGER',
  cancelled_at timestamp with time zone,
  cancelled_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint registration_group_issues_typ_jedla_check
    check (typ_jedla in ('OBED', 'VECERA')),
  constraint registration_group_issues_status_check
    check (status in ('READY', 'WAITING', 'CANCELLED')),
  constraint registration_group_issues_created_by_access_check
    check (created_by_access in ('ADMIN', 'MANAGER', 'DELEGATE'))
);

create index if not exists registration_group_issues_group_date_idx
  on public.registration_group_issues(registration_group_id, datum, typ_jedla, status);

create index if not exists registration_group_issues_created_by_idx
  on public.registration_group_issues(created_by, created_at desc);

create table if not exists public.registration_group_issue_items (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.registration_group_issues(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null default 'REGISTRATION_GROUP',
  volba text,
  status text not null default 'PLANNED',
  remove_reason text,
  moved_to_issue_id uuid references public.registration_group_issues(id) on delete set null,
  removed_at timestamp with time zone,
  removed_by uuid references public.users(id) on delete set null,
  added_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint registration_group_issue_items_source_check
    check (source in ('REGISTRATION_GROUP', 'SEARCH', 'QR')),
  constraint registration_group_issue_items_volba_check
    check (volba is null or volba in ('MASO', 'VEGE', 'DIETA')),
  constraint registration_group_issue_items_status_check
    check (status in ('PLANNED', 'REMOVED')),
  constraint registration_group_issue_items_remove_reason_check
    check (remove_reason is null or remove_reason in ('MOVED_TO_OTHER_ISSUE', 'NO_ENTITLEMENT', 'NO_INTEREST', 'ALREADY_ISSUED', 'USER_INACTIVE', 'MANUAL'))
);

create unique index if not exists registration_group_issue_items_unique_user_idx
  on public.registration_group_issue_items(issue_id, user_id);

create index if not exists registration_group_issue_items_user_status_idx
  on public.registration_group_issue_items(user_id, status);

create table if not exists public.registration_group_issue_pickup_users (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.registration_group_issues(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  created_by uuid references public.users(id) on delete set null,
  unique (issue_id, user_id)
);

create index if not exists registration_group_issue_pickup_users_user_idx
  on public.registration_group_issue_pickup_users(user_id);
