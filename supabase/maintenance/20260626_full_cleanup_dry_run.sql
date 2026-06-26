-- POHODA 2026 database cleanup DRY RUN
-- This script does not modify data. It only reports what the reset would affect.
--
-- Keep only these public.users accounts:
-- - mkm.kassa@gmail.com
-- - baska@pohodafestival.sk
-- - juliana.kohutova93@gmail.com
-- - tomas.horil@gmail.com

with keep_emails(email) as (
  values
    ('mkm.kassa@gmail.com'),
    ('baska@pohodafestival.sk'),
    ('juliana.kohutova93@gmail.com'),
    ('tomas.horil@gmail.com')
),
keep_users as (
  select u.id, lower(trim(u.email)) as email, u.meno, u.priezvisko, u.aktivny
  from public.users u
  join keep_emails k on k.email = lower(trim(u.email))
)
select
  '01_keep_accounts_found' as section,
  coalesce(ku.email, ke.email) as item,
  case when ku.id is null then 0 else 1 end as count_value,
  case when ku.id is null then 'MISSING - create or fix before cleanup' else 'OK - will be kept' end as note
from keep_emails ke
left join keep_users ku on ku.email = ke.email
order by item;

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
)
select
  '02_users_and_roles' as section,
  item,
  count_value,
  note
from (
  select 'users_total' as item, count(*)::bigint as count_value, 'All public.users rows now' as note
  from public.users

  union all
  select 'users_to_keep', count(*)::bigint, 'Expected: 4'
  from keep_users

  union all
  select 'users_to_delete', count(*)::bigint, 'All public.users except the 4 keep accounts'
  from public.users u
  where lower(trim(coalesce(u.email, ''))) not in (select email from keep_emails)

  union all
  select 'active_roles_to_keep', count(*)::bigint, 'ADMIN/PERSONALISTA/etc. roles kept for the 4 accounts'
  from public.app_user_roles r
  where r.user_id in (select id from keep_users)
    and r.active = true

  union all
  select 'roles_to_delete_or_cascade', count(*)::bigint, 'Roles for users that will be removed'
  from public.app_user_roles r
  where r.user_id not in (select id from keep_users)
) rows
order by item;

with keep_emails(email) as (
  values
    ('mkm.kassa@gmail.com'),
    ('baska@pohodafestival.sk'),
    ('juliana.kohutova93@gmail.com'),
    ('tomas.horil@gmail.com')
),
keep_users as (
  select u.id
  from public.users u
  join keep_emails k on k.email = lower(trim(u.email))
)
select
  '03_operational_tables_to_clear' as section,
  table_name,
  count_value,
  note
from (
  select 'registration_groups' as table_name, count(*)::bigint as count_value, 'All registration groups will be deleted' as note from public.registration_groups
  union all select 'user_registration_group_periods', count(*)::bigint, 'All registration group periods will be deleted' from public.user_registration_group_periods
  union all select 'registration_group_managers', count(*)::bigint, 'All registration group manager assignments will be deleted' from public.registration_group_managers
  union all select 'registration_group_issue_delegates', count(*)::bigint, 'All delegated group issue permissions will be deleted' from public.registration_group_issue_delegates
  union all select 'registration_group_issues', count(*)::bigint, 'All new group issues will be deleted' from public.registration_group_issues
  union all select 'registration_group_issue_items', count(*)::bigint, 'All new group issue items will be deleted' from public.registration_group_issue_items
  union all select 'registration_group_issue_pickup_users', count(*)::bigint, 'All new group pickup users will be deleted' from public.registration_group_issue_pickup_users

  union all select 'groups', count(*)::bigint, 'All food groups will be deleted' from public.groups
  union all select 'group_members', count(*)::bigint, 'All food group memberships will be deleted' from public.group_members
  union all select 'group_pickup_users', count(*)::bigint, 'All food group pickup users will be deleted' from public.group_pickup_users
  union all select 'hromadne_vydaje', count(*)::bigint, 'All old bulk issues will be deleted' from public.hromadne_vydaje
  union all select 'hromadny_vydaj_polozky', count(*)::bigint, 'All old bulk issue items will be deleted' from public.hromadny_vydaj_polozky

  union all select 'vydaj_jedal', count(*)::bigint, 'All meal issue records will be deleted' from public.vydaj_jedal
  union all select 'user_food_entitlements', count(*)::bigint, 'All meal entitlements will be deleted' from public.user_food_entitlements
  union all select 'vyber_jedal', count(*)::bigint, 'All meal selections will be deleted' from public.vyber_jedal
  union all select 'personnel_work_periods', count(*)::bigint, 'All work periods will be deleted' from public.personnel_work_periods

  union all select 'registrations', count(*)::bigint, 'All pending/old registration rows will be deleted' from public.registrations
  union all select 'registration_attempts', count(*)::bigint, 'All registration attempt rate-limit rows will be deleted' from public.registration_attempts
  union all select 'user_privacy_consents', count(*)::bigint, 'All privacy consent rows will be deleted' from public.user_privacy_consents

  union all select 'personnel_import_batches', count(*)::bigint, 'All import batches will be deleted' from public.personnel_import_batches
  union all select 'personnel_import_rows', count(*)::bigint, 'All import rows will be deleted' from public.personnel_import_rows
  union all select 'personnel_email_log', count(*)::bigint, 'All e-mail logs will be deleted' from public.personnel_email_log
  union all select 'personnel_audit_log', count(*)::bigint, 'All personnel audit logs will be deleted' from public.personnel_audit_log
  union all select 'user_deregistration_audit', count(*)::bigint, 'All deregistration audit rows will be deleted' from public.user_deregistration_audit

  union all select 'offline_issue_events_server', count(*)::bigint, 'All offline sync event rows will be deleted' from public.offline_issue_events_server
  union all select 'offline_sync_conflicts', count(*)::bigint, 'All offline sync conflict rows will be deleted' from public.offline_sync_conflicts
  union all select 'offline_delta_events', count(*)::bigint, 'All offline delta events will be deleted' from public.offline_delta_events

  union all select 'user_access_codes', count(*)::bigint, 'All access-code logins will be deleted' from public.user_access_codes
  union all select 'login_tokens', count(*)::bigint, 'All magic-login tokens will be deleted' from public.login_tokens
  union all select 'personnel_nfc_tokens', count(*)::bigint, 'All NFC tokens will be deleted' from public.personnel_nfc_tokens
  union all select 'user_qr_codes', count(*)::bigint, 'All user QR assignment history will be deleted' from public.user_qr_codes
  union all select 'personnel_qr_tokens', count(*)::bigint, 'All personnel QR token assignments/reservations will be reset or deleted' from public.personnel_qr_tokens
  union all select 'personnel_qr_batches', count(*)::bigint, 'All personnel QR batches will be deleted' from public.personnel_qr_batches
) rows
order by table_name;

select
  '04_qr_pool_status_now' as section,
  coalesce(status, '(null)') as status,
  count(*)::bigint as count_value,
  'QR pool rows by status before cleanup' as note
from public.qr_codes
group by status
order by status;

with keep_emails(email) as (
  values
    ('mkm.kassa@gmail.com'),
    ('baska@pohodafestival.sk'),
    ('juliana.kohutova93@gmail.com'),
    ('tomas.horil@gmail.com')
),
keep_users as (
  select u.id
  from public.users u
  join keep_emails k on k.email = lower(trim(u.email))
)
select
  '05_kept_accounts_data_that_will_be_cleaned' as section,
  item,
  count_value,
  note
from (
  select 'kept_users_current_qr_code_not_null' as item, count(*)::bigint as count_value, 'Their users.qr_code will be set to null' as note
  from public.users u
  where u.id in (select id from keep_users)
    and nullif(trim(coalesce(u.qr_code, '')), '') is not null

  union all
  select 'kept_users_registration_group_not_null', count(*)::bigint, 'Their users.registration_group_id/note will be cleared'
  from public.users u
  where u.id in (select id from keep_users)
    and (u.registration_group_id is not null or nullif(trim(coalesce(u.registration_group_note, '')), '') is not null)

  union all
  select 'kept_users_entitlements', count(*)::bigint, 'Rows for the 4 accounts that will be deleted'
  from public.user_food_entitlements e
  where e.user_id in (select id from keep_users)

  union all
  select 'kept_users_meal_selections', count(*)::bigint, 'Rows for the 4 accounts that will be deleted'
  from public.vyber_jedal v
  where v.user_id in (select id from keep_users)

  union all
  select 'kept_users_qr_history', count(*)::bigint, 'Rows for the 4 accounts that will be deleted'
  from public.user_qr_codes q
  where q.user_id in (select id from keep_users)

  union all
  select 'kept_users_access_codes', count(*)::bigint, 'Rows for the 4 accounts that will be deleted'
  from public.user_access_codes c
  where c.user_id in (select id from keep_users)
) rows
order by item;
