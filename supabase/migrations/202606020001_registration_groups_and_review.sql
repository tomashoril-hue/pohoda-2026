begin;

create table if not exists public.registration_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists registration_groups_name_unique_idx
  on public.registration_groups (lower(trim(name)));

alter table public.users
  add column if not exists registration_group_id uuid references public.registration_groups(id) on delete set null,
  add column if not exists registration_group_note text,
  add column if not exists review_status text not null default 'APPROVED',
  add column if not exists reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.registrations
  add column if not exists registration_group_id uuid references public.registration_groups(id) on delete set null,
  add column if not exists registration_group_note text;

alter table public.users
  drop constraint if exists users_review_status_check;

alter table public.users
  add constraint users_review_status_check
  check (review_status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED'));

alter table public.app_user_roles
  drop constraint if exists app_user_roles_role_check;

alter table public.app_user_roles
  add constraint app_user_roles_role_check
  check (role in ('ADMIN', 'PERSONALISTA', 'ADMIN_VYDAJ', 'VYDAJ', 'GROUP_CREATOR'));

create index if not exists users_review_status_idx
  on public.users(review_status);

create index if not exists users_registration_group_idx
  on public.users(registration_group_id);

create or replace function public.create_registration(
  p_meno text,
  p_priezvisko text,
  p_email text,
  p_telefon text,
  p_typ_stravy text,
  p_skupina text default null,
  p_registration_group_id uuid default null,
  p_registration_group_note text default null,
  p_zdroj text default 'WEBAPP',
  p_ip text default null
)
returns table(
  registration_id uuid,
  email text,
  confirmation_token text,
  status text,
  result_type text,
  qr_code text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  normalized_email text;
  normalized_note text;
  existing_user_id uuid;
  existing_user_email text;
  existing_user_qr text;
  existing_registration record;
  selected_group_name text;
begin
  normalized_email := lower(trim(coalesce(p_email, '')));
  normalized_note := nullif(trim(coalesce(p_registration_group_note, '')), '');

  if normalized_email = '' then
    raise exception 'Email je povinny';
  end if;

  if p_registration_group_id is null and normalized_note is null then
    raise exception 'Vyber registracnu skupinu alebo moznost Ine';
  end if;

  if p_registration_group_id is not null then
    select rg.name
    into selected_group_name
    from public.registration_groups rg
    where rg.id = p_registration_group_id
      and rg.active = true;

    if selected_group_name is null then
      raise exception 'Registracna skupina neexistuje alebo nie je aktivna';
    end if;
  end if;

  if exists (
    select 1
    from public.registration_attempts a
    where lower(a.email) = normalized_email
      and a.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'Skuste znova o par sekund.';
  end if;

  if p_ip is not null then
    if (
      select count(*)
      from public.registration_attempts a
      where a.ip_address = p_ip
        and a.created_at > now() - interval '10 minutes'
    ) >= 10 then
      raise exception 'Prilis vela registracii z tejto siete. Skuste neskor.';
    end if;
  end if;

  insert into public.registration_attempts (email, ip_address)
  values (normalized_email, p_ip);

  select u.id, u.email, u.qr_code
  into existing_user_id, existing_user_email, existing_user_qr
  from public.users u
  where lower(u.email) = normalized_email
  limit 1;

  if existing_user_id is not null then
    registration_id := null;
    email := existing_user_email;
    confirmation_token := null;
    status := 'CONFIRMED';
    result_type := 'USER_ALREADY_EXISTS';
    qr_code := existing_user_qr;
    return next;
    return;
  end if;

  select *
  into existing_registration
  from public.registrations r
  where lower(r.email) = normalized_email
    and r.status = 'PENDING'
  limit 1;

  if existing_registration is not null then
    registration_id := existing_registration.id;
    email := existing_registration.email;
    confirmation_token := existing_registration.confirmation_token;
    status := existing_registration.status;
    result_type := 'PENDING_ALREADY_EXISTS';
    qr_code := null;
    return next;
    return;
  end if;

  insert into public.registrations (
    meno,
    priezvisko,
    email,
    telefon,
    typ_stravy,
    skupina,
    registration_group_id,
    registration_group_note,
    zdroj,
    status
  )
  values (
    trim(p_meno),
    trim(p_priezvisko),
    normalized_email,
    trim(coalesce(p_telefon, '')),
    upper(trim(coalesce(p_typ_stravy, ''))),
    coalesce(selected_group_name, normalized_note, nullif(trim(coalesce(p_skupina, '')), '')),
    p_registration_group_id,
    normalized_note,
    upper(trim(coalesce(p_zdroj, 'WEBAPP'))),
    'PENDING'
  )
  returning id, registrations.email, registrations.confirmation_token, registrations.status
  into registration_id, email, confirmation_token, status;

  result_type := 'CREATED';
  qr_code := null;
  return next;
end;
$function$;

create or replace function public.confirm_registration(p_token text)
returns table(user_id uuid, qr_code text, email text, status text)
language plpgsql
as $function$
declare
  reg_record record;
  existing_user_id uuid;
  existing_qr_code text;
  existing_email text;
  new_user_id uuid;
begin
  select r.*
  into reg_record
  from public.registrations r
  where r.confirmation_token = p_token
    and r.status = 'PENDING'
    and r.confirmed_at is null
  limit 1
  for update;

  if reg_record is null then
    raise exception 'Token je neplatny alebo uz bol pouzity.';
  end if;

  select u.id, u.qr_code, u.email
  into existing_user_id, existing_qr_code, existing_email
  from public.users u
  where lower(trim(u.email)) = lower(trim(reg_record.email))
  limit 1;

  if existing_user_id is not null then
    update public.registrations r
    set
      status = 'CONFIRMED',
      confirmed_at = now(),
      created_user_id = existing_user_id,
      updated_at = now()
    where r.id = reg_record.id
      and r.status = 'PENDING'
      and r.confirmed_at is null;

    return query
    select existing_user_id, existing_qr_code, existing_email, 'ALREADY_CONFIRMED'::text;
    return;
  end if;

  insert into public.users (
    meno,
    priezvisko,
    email,
    telefon,
    typ_stravy,
    skupina,
    registration_group_id,
    registration_group_note,
    review_status,
    zdroj,
    aktivny,
    moze_hromadny_vydaj
  )
  values (
    reg_record.meno,
    reg_record.priezvisko,
    lower(trim(reg_record.email)),
    reg_record.telefon,
    reg_record.typ_stravy,
    reg_record.skupina,
    reg_record.registration_group_id,
    reg_record.registration_group_note,
    'PENDING_REVIEW',
    reg_record.zdroj,
    'ANO',
    'NIE'
  )
  returning id into new_user_id;

  update public.registrations r
  set
    status = 'CONFIRMED',
    confirmed_at = now(),
    created_user_id = new_user_id,
    updated_at = now()
  where r.id = reg_record.id
    and r.status = 'PENDING'
    and r.confirmed_at is null;

  return query
  select new_user_id, null::text, lower(trim(reg_record.email)), 'PENDING_REVIEW'::text;
end;
$function$;

create or replace function public.approve_registration_user(
  p_user_id uuid,
  p_actor_id uuid,
  p_registration_group_id uuid,
  p_registration_group_note text default null
)
returns table(qr_code text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  assigned_qr record;
  current_qr text;
  current_review_status text;
begin
  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.review_status = 'PENDING_REVIEW'
  ) then
    raise exception 'USER_NOT_PENDING_REVIEW';
  end if;

  if not exists (
    select 1
    from public.registration_groups rg
    where rg.id = p_registration_group_id
      and rg.active = true
  ) then
    raise exception 'REGISTRATION_GROUP_REQUIRED';
  end if;

  select u.qr_code, u.review_status
  into current_qr, current_review_status
  from public.users u
  where u.id = p_user_id
  for update;

  if current_review_status <> 'PENDING_REVIEW' then
    raise exception 'USER_NOT_PENDING_REVIEW';
  end if;

  if current_qr is null then
    select *
    into assigned_qr
    from public.assign_free_qr_to_user(
      p_user_id,
      p_actor_id,
      'Priradene automaticky pri schvaleni registracie.'
    );

    current_qr := assigned_qr.qr_code;
  end if;

  if current_qr is null then
    raise exception 'NO_FREE_QR_AVAILABLE';
  end if;

  update public.users
  set
    registration_group_id = p_registration_group_id,
    registration_group_note = nullif(trim(coalesce(p_registration_group_note, '')), ''),
    review_status = 'APPROVED',
    reviewed_by = p_actor_id,
    reviewed_at = now(),
    updated_at = now()
  where id = p_user_id;

  return query select current_qr;
end;
$function$;

grant execute on function public.create_registration(
  text, text, text, text, text, text, uuid, text, text, text
) to anon, authenticated, service_role;

grant execute on function public.approve_registration_user(uuid, uuid, uuid, text)
  to service_role;

commit;
