begin;

drop function if exists public.approve_registration_user(uuid, uuid, uuid, text);

drop function if exists public.create_registration(
  text, text, text, text, text, text, uuid, text, text, text
);

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
  new_qr text;
begin
  select r.*
  into reg_record
  from public.registrations r
  where r.confirmation_token = p_token
    and r.status = 'PENDING'
    and r.confirmed_at is null
  limit 1;

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
    set status = 'CONFIRMED', confirmed_at = now(), created_user_id = existing_user_id
    where r.id = reg_record.id and r.status = 'PENDING' and r.confirmed_at is null;

    return query
    select existing_user_id, existing_qr_code, existing_email, 'ALREADY_CONFIRMED'::text;
    return;
  end if;

  insert into public.users (
    meno, priezvisko, email, telefon, typ_stravy, skupina, zdroj, aktivny, moze_hromadny_vydaj
  )
  values (
    reg_record.meno, reg_record.priezvisko, lower(trim(reg_record.email)),
    reg_record.telefon, reg_record.typ_stravy, reg_record.skupina, reg_record.zdroj, 'ANO', 'NIE'
  )
  returning id into new_user_id;

  new_qr := public.assign_qr_to_user(new_user_id);

  update public.registrations r
  set status = 'CONFIRMED', confirmed_at = now(), created_user_id = new_user_id
  where r.id = reg_record.id and r.status = 'PENDING' and r.confirmed_at is null;

  return query
  select new_user_id, new_qr, lower(trim(reg_record.email)), 'CONFIRMED'::text;
end;
$function$;

-- Additive columns and registration_groups stay in place intentionally.
-- Keeping unused additive schema is safer than deleting review data during rollback.

commit;
