begin;

alter table public.app_user_roles
  drop constraint if exists app_user_roles_role_check;

alter table public.app_user_roles
  add constraint app_user_roles_role_check
  check (role in (
    'ADMIN',
    'PERSONALISTA',
    'ADMIN_VYDAJ',
    'VYDAJ',
    'GROUP_CREATOR',
    'WRISTBAND_KIOSK',
    'MENU_KIOSK',
    'OFFLINE_OBSLUHA',
    'SAMOSTATNE_OBJEDNAVANIE_STRAVY'
  ));

alter table public.users
  add column if not exists self_ordering_required boolean not null default false,
  add column if not exists self_ordering_opened_at timestamp with time zone,
  add column if not exists self_ordering_completed_at timestamp with time zone;

create index if not exists users_self_ordering_required_idx
  on public.users(self_ordering_required, self_ordering_completed_at);

create table if not exists public.self_ordering_login_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamp with time zone not null,
  used_count integer not null default 0,
  last_used_at timestamp with time zone,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create index if not exists self_ordering_login_tokens_user_idx
  on public.self_ordering_login_tokens(user_id, expires_at desc);

alter table public.personnel_email_log
  drop constraint if exists personnel_email_log_type_check;

alter table public.personnel_email_log
  add constraint personnel_email_log_type_check
  check (type in ('WELCOME_IMPORTED_USER', 'ACCESS_CODES_EXPORT', 'SELF_ORDERING_INVITE'));

alter table public.user_food_entitlements
  drop constraint if exists user_food_entitlements_source_check;

alter table public.user_food_entitlements
  add constraint user_food_entitlements_source_check
  check (source in ('ADMIN', 'PERSONALISTA', 'IMPORT', 'SYSTEM', 'SELF_ORDERING'));

commit;
