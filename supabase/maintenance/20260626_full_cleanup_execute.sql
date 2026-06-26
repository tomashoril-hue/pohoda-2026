-- POHODA 2026 full data cleanup - EXECUTE
--
-- WARNING: This script deletes operational data.
-- Run only after:
-- 1. Supabase database backup is available.
-- 2. 20260626_full_cleanup_dry_run_single_result.sql was checked.
-- 3. The four keep accounts and their roles were confirmed.
--
-- This script keeps only these public.users accounts:
-- - mkm.kassa@gmail.com
-- - baska@pohodafestival.sk
-- - juliana.kohutova93@gmail.com
-- - tomas.horil@gmail.com
--
-- It keeps their app_user_roles rows, but removes their operational data
-- such as QR assignments, entitlements, meal selections and registration groups.
--
-- It also deletes the old QR pool and creates 5000 new VOLNY QR codes.
-- Safety: this script requires backup_pre_cleanup_20260626 to exist.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.schemata
    where schema_name = 'backup_pre_cleanup_20260626'
  ) then
    raise exception 'Cleanup aborted: run 20260626_create_pre_cleanup_backup.sql first.';
  end if;
end $$;

create temp table _pohoda_cleanup_keep_emails(email text primary key) on commit drop;

insert into _pohoda_cleanup_keep_emails(email)
values
  ('mkm.kassa@gmail.com'),
  ('baska@pohodafestival.sk'),
  ('juliana.kohutova93@gmail.com'),
  ('tomas.horil@gmail.com');

create temp table _pohoda_cleanup_keep_users as
select u.id, lower(trim(u.email)) as email
from public.users u
join _pohoda_cleanup_keep_emails k on k.email = lower(trim(u.email));

do $$
declare
  v_keep_count integer;
  v_active_role_count integer;
begin
  select count(*) into v_keep_count from _pohoda_cleanup_keep_users;

  if v_keep_count <> 4 then
    raise exception 'Cleanup aborted: expected 4 keep users, found %.', v_keep_count;
  end if;

  select count(*)
  into v_active_role_count
  from public.app_user_roles r
  where r.user_id in (select id from _pohoda_cleanup_keep_users)
    and r.active = true;

  if v_active_role_count = 0 then
    raise exception 'Cleanup aborted: no active app_user_roles found for keep users.';
  end if;
end $$;

-- New registration-group issue model.
delete from public.registration_group_issue_pickup_users;
delete from public.registration_group_issue_items;
delete from public.registration_group_issues;
delete from public.registration_group_issue_delegates;
delete from public.registration_group_managers;
delete from public.user_registration_group_periods;

-- Old food groups and legacy bulk issue model.
delete from public.hromadny_vydaj_polozky;
delete from public.hromadne_vydaje;
delete from public.group_pickup_users;
delete from public.group_members;
delete from public.groups;

-- Meal operation data.
delete from public.vydaj_jedal;
delete from public.vyber_jedal;
delete from public.user_food_entitlements;
delete from public.personnel_work_periods;

-- Registrations, privacy and import/communication history.
delete from public.registrations;
delete from public.registration_attempts;
delete from public.user_privacy_consents;
delete from public.personnel_import_rows;
delete from public.personnel_import_batches;
delete from public.personnel_email_log;
delete from public.personnel_audit_log;
delete from public.user_deregistration_audit;

-- Offline sync data.
delete from public.offline_sync_conflicts;
delete from public.offline_issue_events_server;
delete from public.offline_delta_events;

-- Access, QR, NFC and temporary auth tokens.
delete from public.user_access_codes;
delete from public.login_tokens;
delete from public.personnel_nfc_tokens;
delete from public.user_qr_codes;
delete from public.personnel_qr_tokens;
delete from public.personnel_qr_batches;
delete from public.personnel_sheet_syncs;

-- Remove all registration groups after dependent data and user references are gone.
update public.users
set
  registration_group_id = null,
  registration_group_note = null,
  qr_code = null,
  personal_note = null,
  reviewed_by = null,
  reviewed_at = null,
  review_status = 'APPROVED',
  updated_at = now()
where id in (select id from _pohoda_cleanup_keep_users);

update public.users
set
  registration_group_id = null,
  registration_group_note = null,
  reviewed_by = null,
  manual_created_by = null
where id not in (select id from _pohoda_cleanup_keep_users);

delete from public.registration_groups;

-- Keep only roles for the four retained users.
delete from public.app_user_roles
where user_id not in (select id from _pohoda_cleanup_keep_users);

-- Delete all public users except the four retained accounts.
delete from public.users
where id not in (select id from _pohoda_cleanup_keep_users);

-- Replace the whole QR pool with 5000 fresh free QR codes.
delete from public.qr_codes;

create temp table _pohoda_new_qr_codes (
  code text primary key
) on commit drop;

insert into _pohoda_new_qr_codes (code)
select code
from (
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) as code
  from generate_series(1, 7000)
) generated
group by code
order by code
limit 5000;

do $$
declare
  v_new_qr_count integer;
begin
  select count(*) into v_new_qr_count from _pohoda_new_qr_codes;

  if v_new_qr_count <> 5000 then
    raise exception 'Cleanup aborted: expected 5000 newly generated QR codes, got %.', v_new_qr_count;
  end if;
end $$;

insert into public.qr_codes (
  id,
  code,
  status,
  assigned_user_id,
  assigned_at,
  created_at
)
select
  gen_random_uuid(),
  code,
  'VOLNY',
  null,
  null,
  now()
from _pohoda_new_qr_codes;

commit;

-- Final verification report.
with keep_emails(email) as (
  values
    ('mkm.kassa@gmail.com'),
    ('baska@pohodafestival.sk'),
    ('juliana.kohutova93@gmail.com'),
    ('tomas.horil@gmail.com')
),
keep_users as (
  select u.id, lower(trim(u.email)) as email
  from public.users u
  join keep_emails k on k.email = lower(trim(u.email))
),
report as (
  select 'users_total' as item, count(*)::bigint as count_value from public.users
  union all select 'users_kept', count(*)::bigint from keep_users
  union all select 'active_roles_kept', count(*)::bigint from public.app_user_roles r where r.user_id in (select id from keep_users) and r.active = true
  union all select 'registration_groups', count(*)::bigint from public.registration_groups
  union all select 'groups', count(*)::bigint from public.groups
  union all select 'registration_group_issues', count(*)::bigint from public.registration_group_issues
  union all select 'hromadne_vydaje', count(*)::bigint from public.hromadne_vydaje
  union all select 'vydaj_jedal', count(*)::bigint from public.vydaj_jedal
  union all select 'user_food_entitlements', count(*)::bigint from public.user_food_entitlements
  union all select 'vyber_jedal', count(*)::bigint from public.vyber_jedal
  union all select 'user_qr_codes', count(*)::bigint from public.user_qr_codes
  union all select 'user_access_codes', count(*)::bigint from public.user_access_codes
  union all select 'personnel_email_log', count(*)::bigint from public.personnel_email_log
  union all select 'personnel_audit_log', count(*)::bigint from public.personnel_audit_log
  union all select 'offline_issue_events_server', count(*)::bigint from public.offline_issue_events_server
  union all select 'qr_codes_total', count(*)::bigint from public.qr_codes
  union all select 'qr_codes_free', count(*)::bigint from public.qr_codes where status = 'VOLNY' and assigned_user_id is null
)
select item, count_value
from report
order by item;
