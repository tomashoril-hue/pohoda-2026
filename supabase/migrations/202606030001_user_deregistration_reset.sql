begin;

create extension if not exists pgcrypto;

create table if not exists public.user_deregistration_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references public.users(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  original_email text not null,
  normalized_email text not null,
  original_meno text,
  original_priezvisko text,
  original_telefon text,
  original_qr_code text,
  reset_email text not null,
  reason text,
  original_user jsonb not null default '{}'::jsonb,
  original_roles jsonb not null default '[]'::jsonb,
  original_active_qr_codes jsonb not null default '[]'::jsonb,
  original_registrations jsonb not null default '[]'::jsonb,
  original_group_memberships jsonb not null default '[]'::jsonb,
  invalidated_qr_count integer not null default 0,
  removed_group_memberships_count integer not null default 0,
  cancelled_pending_registrations_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists user_deregistration_audit_email_idx
  on public.user_deregistration_audit (normalized_email, created_at desc);

create index if not exists user_deregistration_audit_target_idx
  on public.user_deregistration_audit (target_user_id, created_at desc);

revoke all on public.user_deregistration_audit from anon, authenticated;
grant select, insert on public.user_deregistration_audit to service_role;

create or replace function public.reset_user_for_registration(
  p_email text,
  p_actor_id uuid default null,
  p_reason text default null
)
returns table(
  user_id uuid,
  audit_id uuid,
  original_email text,
  reset_email text,
  invalidated_qr_count integer,
  removed_group_memberships_count integer,
  cancelled_pending_registrations_count integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text;
  v_user public.users%rowtype;
  v_reset_email text;
  v_audit_id uuid;
  v_active_qr_codes text[] := array[]::text[];
  v_roles jsonb := '[]'::jsonb;
  v_active_qr_snapshot jsonb := '[]'::jsonb;
  v_registrations jsonb := '[]'::jsonb;
  v_memberships jsonb := '[]'::jsonb;
  v_invalidated_qr_count integer := 0;
  v_removed_memberships_count integer := 0;
  v_cancelled_registrations_count integer := 0;
begin
  v_email := lower(trim(coalesce(p_email, '')));

  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select *
  into v_user
  from public.users u
  where lower(trim(u.email)) = v_email
  order by u.created_at desc
  limit 1
  for update;

  if v_user.id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  v_reset_email := 'deregistered+' || replace(v_user.id::text, '-', '') || '@pohoda.local';

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_roles
  from public.app_user_roles r
  where r.user_id = v_user.id;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
  into v_active_qr_snapshot
  from public.user_qr_codes q
  where q.user_id = v_user.id
    and q.active = true;

  select coalesce(array_agg(q.qr_code), array[]::text[])
  into v_active_qr_codes
  from public.user_qr_codes q
  where q.user_id = v_user.id
    and q.active = true;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_registrations
  from public.registrations r
  where lower(trim(r.email)) = v_email
     or r.created_user_id = v_user.id;

  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
  into v_memberships
  from public.group_members m
  where m.user_id = v_user.id;

  insert into public.user_deregistration_audit (
    target_user_id,
    actor_user_id,
    original_email,
    normalized_email,
    original_meno,
    original_priezvisko,
    original_telefon,
    original_qr_code,
    reset_email,
    reason,
    original_user,
    original_roles,
    original_active_qr_codes,
    original_registrations,
    original_group_memberships
  )
  values (
    v_user.id,
    p_actor_id,
    v_user.email,
    v_email,
    v_user.meno,
    v_user.priezvisko,
    v_user.telefon,
    v_user.qr_code,
    v_reset_email,
    nullif(trim(coalesce(p_reason, '')), ''),
    to_jsonb(v_user),
    v_roles,
    v_active_qr_snapshot,
    v_registrations,
    v_memberships
  )
  returning id into v_audit_id;

  update public.app_user_roles r
  set
    active = false,
    updated_at = now()
  where r.user_id = v_user.id
    and r.active = true;

  update public.user_qr_codes q
  set
    active = false,
    invalidated_by = p_actor_id,
    invalidated_at = now(),
    note = coalesce(q.note || ' | ', '') || 'Zneplatnene pri odregistrovani pouzivatela.'
  where q.user_id = v_user.id
    and q.active = true;

  get diagnostics v_invalidated_qr_count = row_count;

  update public.personnel_qr_tokens t
  set
    active = false,
    status = 'INVALIDATED',
    invalidated_by = p_actor_id,
    invalidated_at = now(),
    updated_at = now(),
    note = coalesce(t.note || ' | ', '') || 'Zneplatnene pri odregistrovani pouzivatela.'
  where t.user_id = v_user.id
    and t.active = true;

  update public.personnel_nfc_tokens t
  set
    active = false,
    status = 'INVALIDATED',
    invalidated_by = p_actor_id,
    invalidated_at = now(),
    updated_at = now(),
    note = coalesce(t.note || ' | ', '') || 'Zneplatnene pri odregistrovani pouzivatela.'
  where t.user_id = v_user.id
    and t.active = true;

  update public.qr_codes q
  set
    status = 'NEPLATNY',
    assigned_user_id = v_user.id,
    assigned_at = coalesce(q.assigned_at, now())
  where q.assigned_user_id = v_user.id
     or q.code = any(v_active_qr_codes);

  update public.personnel_work_periods p
  set
    active = false,
    updated_by = p_actor_id,
    updated_at = now()
  where p.user_id = v_user.id
    and p.active = true;

  delete from public.group_members m
  where m.user_id = v_user.id;

  get diagnostics v_removed_memberships_count = row_count;

  update public.registrations r
  set
    status = 'DEREGISTERED',
    updated_at = now()
  where lower(trim(r.email)) = v_email
    and r.status = 'PENDING';

  get diagnostics v_cancelled_registrations_count = row_count;

  update public.registration_attempts a
  set email = v_reset_email
  where lower(trim(a.email)) = v_email;

  update public.users u
  set
    meno = 'Odregistrovany',
    priezvisko = 'Pouzivatel',
    email = v_reset_email,
    telefon = null,
    qr_code = null,
    aktivny = 'NIE',
    review_status = 'REJECTED',
    reviewed_by = p_actor_id,
    reviewed_at = now(),
    registration_group_id = null,
    registration_group_note = null,
    personal_note = coalesce(u.personal_note || ' | ', '') || 'Odregistrovany. Audit: ' || v_audit_id::text,
    updated_at = now()
  where u.id = v_user.id;

  update public.user_deregistration_audit a
  set
    invalidated_qr_count = v_invalidated_qr_count,
    removed_group_memberships_count = v_removed_memberships_count,
    cancelled_pending_registrations_count = v_cancelled_registrations_count
  where a.id = v_audit_id;

  return query
  select
    v_user.id,
    v_audit_id,
    v_user.email,
    v_reset_email,
    v_invalidated_qr_count,
    v_removed_memberships_count,
    v_cancelled_registrations_count;
end;
$function$;

revoke all on function public.reset_user_for_registration(text, uuid, text) from public;
grant execute on function public.reset_user_for_registration(text, uuid, text) to service_role;

commit;
