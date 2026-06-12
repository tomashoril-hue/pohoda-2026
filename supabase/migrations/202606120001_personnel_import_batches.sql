create table if not exists public.personnel_import_batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_file_name text,
  status text not null default 'DRAFT',
  created_by uuid references public.users(id) on delete set null,
  imported_at timestamp with time zone,
  imported_by uuid references public.users(id) on delete set null,
  cancelled_at timestamp with time zone,
  cancelled_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint personnel_import_batches_status_check
    check (status in ('DRAFT', 'IMPORTED', 'CANCELLED'))
);

create index if not exists personnel_import_batches_created_by_idx
  on public.personnel_import_batches(created_by, created_at desc);

alter table public.personnel_import_batches
  add column if not exists name text,
  add column if not exists source text default 'CSV',
  add column if not exists filename text,
  add column if not exists source_file_name text,
  add column if not exists imported_at timestamp with time zone,
  add column if not exists imported_by uuid references public.users(id) on delete set null,
  add column if not exists cancelled_at timestamp with time zone,
  add column if not exists cancelled_by uuid references public.users(id) on delete set null;

update public.personnel_import_batches
set
  name = coalesce(name, filename, source_file_name, 'Import'),
  source_file_name = coalesce(source_file_name, filename)
where name is null
   or source_file_name is null;

alter table public.personnel_import_batches
  alter column name set not null;

alter table public.personnel_import_batches
  alter column source set default 'CSV';

alter table public.personnel_import_batches
  drop constraint if exists personnel_import_batches_status_check;

alter table public.personnel_import_batches
  add constraint personnel_import_batches_status_check
  check (status in ('DRAFT', 'VALIDATED', 'IMPORTED', 'FAILED', 'CANCELLED'));

create table if not exists public.personnel_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.personnel_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  meno text not null,
  priezvisko text not null,
  email text,
  telefon text,
  typ_stravy text not null default 'MASO',
  registration_group_id uuid references public.registration_groups(id) on delete set null,
  valid_from date not null,
  valid_to date not null,
  obed boolean not null default true,
  vecera boolean not null default false,
  assign_qr boolean not null default true,
  generate_access_code boolean not null default false,
  access_code_plain text,
  status text not null default 'READY',
  message text,
  created_user_id uuid references public.users(id) on delete set null,
  welcome_email_status text not null default 'NOT_SENT',
  welcome_email_sent_at timestamp with time zone,
  welcome_email_sent_by uuid references public.users(id) on delete set null,
  welcome_email_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint personnel_import_rows_status_check
    check (status in ('READY', 'SKIP', 'ERROR', 'IMPORTED')),
  constraint personnel_import_rows_email_status_check
    check (welcome_email_status in ('NOT_SENT', 'SENT', 'FAILED', 'SKIPPED')),
  constraint personnel_import_rows_food_check
    check (typ_stravy in ('MASO', 'VEGE', 'DIETA')),
  constraint personnel_import_rows_dates_check
    check (valid_to >= valid_from),
  unique (batch_id, row_number)
);

create index if not exists personnel_import_rows_batch_idx
  on public.personnel_import_rows(batch_id, row_number);

alter table public.personnel_import_rows
  add column if not exists normalized_data jsonb not null default '{}'::jsonb,
  add column if not exists error_message text,
  add column if not exists user_id uuid references public.users(id) on delete set null,
  add column if not exists meno text,
  add column if not exists priezvisko text,
  add column if not exists email text,
  add column if not exists telefon text,
  add column if not exists typ_stravy text not null default 'MASO',
  add column if not exists registration_group_id uuid references public.registration_groups(id) on delete set null,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists obed boolean not null default true,
  add column if not exists vecera boolean not null default false,
  add column if not exists assign_qr boolean not null default true,
  add column if not exists generate_access_code boolean not null default false,
  add column if not exists access_code_plain text,
  add column if not exists message text,
  add column if not exists created_user_id uuid references public.users(id) on delete set null,
  add column if not exists welcome_email_status text not null default 'NOT_SENT',
  add column if not exists welcome_email_sent_at timestamp with time zone,
  add column if not exists welcome_email_sent_by uuid references public.users(id) on delete set null,
  add column if not exists welcome_email_error text;

update public.personnel_import_rows
set
  meno = coalesce(meno, normalized_data->>'meno', raw_data->>'meno', ''),
  priezvisko = coalesce(priezvisko, normalized_data->>'priezvisko', raw_data->>'priezvisko', ''),
  valid_from = coalesce(valid_from, nullif(normalized_data->>'valid_from', '')::date, current_date),
  valid_to = coalesce(valid_to, nullif(normalized_data->>'valid_to', '')::date, current_date),
  message = coalesce(message, error_message),
  created_user_id = coalesce(created_user_id, user_id)
where meno is null
   or priezvisko is null
   or valid_from is null
   or valid_to is null
   or message is null
   or created_user_id is null;

alter table public.personnel_import_rows
  alter column meno set not null,
  alter column priezvisko set not null,
  alter column valid_from set not null,
  alter column valid_to set not null;

alter table public.personnel_import_rows
  drop constraint if exists personnel_import_rows_status_check,
  drop constraint if exists personnel_import_rows_email_status_check,
  drop constraint if exists personnel_import_rows_food_check,
  drop constraint if exists personnel_import_rows_dates_check;

alter table public.personnel_import_rows
  add constraint personnel_import_rows_status_check
  check (status in ('READY', 'SKIP', 'ERROR', 'IMPORTED', 'PENDING', 'VALID', 'WARNING', 'SKIPPED')),
  add constraint personnel_import_rows_email_status_check
  check (welcome_email_status in ('NOT_SENT', 'SENT', 'FAILED', 'SKIPPED')),
  add constraint personnel_import_rows_food_check
  check (typ_stravy in ('MASO', 'VEGE', 'DIETA')),
  add constraint personnel_import_rows_dates_check
  check (valid_to >= valid_from);

create index if not exists personnel_import_rows_user_idx
  on public.personnel_import_rows(created_user_id);

create index if not exists personnel_import_rows_registration_group_idx
  on public.personnel_import_rows(batch_id, registration_group_id);

create table if not exists public.user_access_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  access_code_plain text,
  meno_key text not null,
  priezvisko_key text not null,
  active boolean not null default true,
  label text,
  created_by uuid references public.users(id) on delete set null,
  revoked_at timestamp with time zone,
  revoked_by uuid references public.users(id) on delete set null,
  last_used_at timestamp with time zone,
  failed_attempts integer not null default 0,
  last_failed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists user_access_codes_lookup_idx
  on public.user_access_codes(meno_key, priezvisko_key, active);

create index if not exists user_access_codes_user_idx
  on public.user_access_codes(user_id, active);

alter table public.user_access_codes
  add column if not exists access_code_plain text;

create table if not exists public.personnel_email_log (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.personnel_import_batches(id) on delete set null,
  import_row_id uuid references public.personnel_import_rows(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  email text not null,
  type text not null,
  status text not null,
  provider text,
  provider_message_id text,
  error_message text,
  sent_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint personnel_email_log_type_check
    check (type in ('WELCOME_IMPORTED_USER', 'ACCESS_CODES_EXPORT')),
  constraint personnel_email_log_status_check
    check (status in ('SENT', 'FAILED'))
);

alter table public.personnel_email_log
  drop constraint if exists personnel_email_log_type_check;

alter table public.personnel_email_log
  add constraint personnel_email_log_type_check
  check (type in ('WELCOME_IMPORTED_USER', 'ACCESS_CODES_EXPORT'));

create index if not exists personnel_email_log_import_batch_idx
  on public.personnel_email_log(import_batch_id, created_at desc);

create index if not exists personnel_email_log_user_idx
  on public.personnel_email_log(user_id, created_at desc);
