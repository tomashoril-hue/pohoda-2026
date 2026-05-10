begin;

create extension if not exists pgcrypto;

alter table public.users
  alter column email drop not null;

alter table public.users
  add column if not exists active boolean not null default true,
  add column if not exists registration_source text not null default 'PUBLIC',
  add column if not exists manual_created_by uuid references public.users(id) on delete set null,
  add column if not exists personal_note text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_registration_source_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_registration_source_check
      check (registration_source in ('PUBLIC', 'MANUAL', 'BULK_IMPORT', 'GOOGLE_SHEETS'));
  end if;
end $$;

create table if not exists public.app_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_user_roles_role_check'
      and conrelid = 'public.app_user_roles'::regclass
  ) then
    alter table public.app_user_roles
      add constraint app_user_roles_role_check
      check (role in ('ADMIN', 'PERSONALISTA'));
  end if;
end $$;

create table if not exists public.personnel_audit_log (
  id bigserial primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  action text not null,
  entity_table text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.personnel_work_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  valid_from date not null,
  valid_to date not null,
  active boolean not null default true,
  source text not null default 'MANUAL',
  note text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_work_periods_range_check'
      and conrelid = 'public.personnel_work_periods'::regclass
  ) then
    alter table public.personnel_work_periods
      add constraint personnel_work_periods_range_check
      check (valid_to >= valid_from);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_work_periods_source_check'
      and conrelid = 'public.personnel_work_periods'::regclass
  ) then
    alter table public.personnel_work_periods
      add constraint personnel_work_periods_source_check
      check (source in ('MANUAL', 'BULK_IMPORT', 'GOOGLE_SHEETS'));
  end if;
end $$;

alter table public.user_food_entitlements
  add column if not exists source text not null default 'MANUAL',
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists updated_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_food_entitlements_source_check'
      and conrelid = 'public.user_food_entitlements'::regclass
  ) then
    alter table public.user_food_entitlements
      add constraint user_food_entitlements_source_check
      check (source in ('MANUAL', 'BULK_IMPORT', 'GOOGLE_SHEETS', 'PUBLIC_DEFAULT'));
  end if;
end $$;

create index if not exists user_food_entitlements_user_date_idx
  on public.user_food_entitlements(user_id, datum);

create table if not exists public.personnel_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'DRAFT',
  filename text,
  google_sheet_id text,
  google_sheet_range text,
  group_id uuid references public.groups(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  error_rows integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_import_batches_source_check'
      and conrelid = 'public.personnel_import_batches'::regclass
  ) then
    alter table public.personnel_import_batches
      add constraint personnel_import_batches_source_check
      check (source in ('EXCEL', 'CSV', 'GOOGLE_SHEETS', 'MANUAL_BULK'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_import_batches_status_check'
      and conrelid = 'public.personnel_import_batches'::regclass
  ) then
    alter table public.personnel_import_batches
      add constraint personnel_import_batches_status_check
      check (status in ('DRAFT', 'VALIDATED', 'IMPORTED', 'FAILED', 'CANCELLED'));
  end if;
end $$;

create table if not exists public.personnel_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.personnel_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  error_message text,
  user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_import_rows_status_check'
      and conrelid = 'public.personnel_import_rows'::regclass
  ) then
    alter table public.personnel_import_rows
      add constraint personnel_import_rows_status_check
      check (status in ('PENDING', 'VALID', 'WARNING', 'IMPORTED', 'ERROR', 'SKIPPED'));
  end if;
end $$;

create table if not exists public.personnel_qr_batches (
  id uuid primary key default gen_random_uuid(),
  purpose text not null default 'USER',
  status text not null default 'DRAFT',
  group_id uuid references public.groups(id) on delete set null,
  count_requested integer not null default 0,
  count_created integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_qr_batches_purpose_check'
      and conrelid = 'public.personnel_qr_batches'::regclass
  ) then
    alter table public.personnel_qr_batches
      add constraint personnel_qr_batches_purpose_check
      check (purpose in ('USER', 'BLANK', 'WRISTBAND', 'PRINT'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_qr_batches_status_check'
      and conrelid = 'public.personnel_qr_batches'::regclass
  ) then
    alter table public.personnel_qr_batches
      add constraint personnel_qr_batches_status_check
      check (status in ('DRAFT', 'CREATED', 'PRINTED', 'CANCELLED'));
  end if;
end $$;

create table if not exists public.personnel_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  qr_code text not null unique,
  user_id uuid references public.users(id) on delete set null,
  batch_id uuid references public.personnel_qr_batches(id) on delete set null,
  token_type text not null default 'QR',
  status text not null default 'BLANK',
  active boolean not null default true,
  assigned_at timestamptz,
  assigned_by uuid references public.users(id) on delete set null,
  invalidated_at timestamptz,
  invalidated_by uuid references public.users(id) on delete set null,
  replaced_by uuid references public.personnel_qr_tokens(id) on delete set null,
  printed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_qr_tokens_token_type_check'
      and conrelid = 'public.personnel_qr_tokens'::regclass
  ) then
    alter table public.personnel_qr_tokens
      add constraint personnel_qr_tokens_token_type_check
      check (token_type in ('QR', 'WRISTBAND_QR'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_qr_tokens_status_check'
      and conrelid = 'public.personnel_qr_tokens'::regclass
  ) then
    alter table public.personnel_qr_tokens
      add constraint personnel_qr_tokens_status_check
      check (status in ('BLANK', 'ASSIGNED', 'INVALIDATED', 'REPLACED', 'LOST'));
  end if;
end $$;

alter table public.user_qr_codes
  add column if not exists personnel_qr_token_id uuid references public.personnel_qr_tokens(id) on delete set null,
  add column if not exists assigned_by uuid references public.users(id) on delete set null,
  add column if not exists invalidated_by uuid references public.users(id) on delete set null,
  add column if not exists invalidated_at timestamptz,
  add column if not exists note text;

create table if not exists public.personnel_nfc_tokens (
  id uuid primary key default gen_random_uuid(),
  token_uid text not null unique,
  user_id uuid references public.users(id) on delete set null,
  status text not null default 'ASSIGNED',
  active boolean not null default true,
  assigned_at timestamptz,
  assigned_by uuid references public.users(id) on delete set null,
  invalidated_at timestamptz,
  invalidated_by uuid references public.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personnel_nfc_tokens_status_check'
      and conrelid = 'public.personnel_nfc_tokens'::regclass
  ) then
    alter table public.personnel_nfc_tokens
      add constraint personnel_nfc_tokens_status_check
      check (status in ('ASSIGNED', 'INVALIDATED', 'REPLACED', 'LOST'));
  end if;
end $$;

create table if not exists public.personnel_sheet_syncs (
  id uuid primary key default gen_random_uuid(),
  google_sheet_id text not null,
  sheet_name text,
  group_id uuid references public.groups(id) on delete set null,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_user_roles_user_active_idx
  on public.app_user_roles(user_id, active);

create index if not exists personnel_audit_target_idx
  on public.personnel_audit_log(target_user_id, created_at desc);

create index if not exists personnel_audit_actor_idx
  on public.personnel_audit_log(actor_user_id, created_at desc);

create index if not exists personnel_work_periods_user_idx
  on public.personnel_work_periods(user_id, valid_from, valid_to);

create index if not exists personnel_import_batches_created_idx
  on public.personnel_import_batches(created_at desc);

create index if not exists personnel_import_rows_batch_status_idx
  on public.personnel_import_rows(batch_id, status);

create index if not exists personnel_qr_tokens_user_active_idx
  on public.personnel_qr_tokens(user_id, active);

create index if not exists personnel_qr_tokens_batch_idx
  on public.personnel_qr_tokens(batch_id);

create index if not exists personnel_nfc_tokens_user_active_idx
  on public.personnel_nfc_tokens(user_id, active);

create index if not exists personnel_sheet_syncs_active_idx
  on public.personnel_sheet_syncs(active, group_id);

commit;
