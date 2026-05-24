begin;

create or replace function public.replace_user_qr_from_pool(
  p_user_id uuid,
  p_qr_code text default null,
  p_assigned_by uuid default null,
  p_note text default null
)
returns table (
  qr_code_id uuid,
  qr_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qr record;
  v_old_codes text[];
  v_user_qr_id uuid;
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
    for update
  ) then
    raise exception 'USER_NOT_FOUND';
  end if;

  with candidate as (
    select q.id
    from public.qr_codes q
    where q.status = 'VOLNY'
      and q.assigned_user_id is null
      and not exists (
        select 1
        from public.user_qr_codes uq
        where uq.qr_code = q.code
          and uq.user_id <> p_user_id
      )
      and not exists (
        select 1
        from public.user_qr_codes uq
        where uq.qr_code = q.code
          and uq.user_id = p_user_id
          and uq.active = true
      )
    order by q.created_at asc
    limit 1
    for update skip locked
  )
  update public.qr_codes q
  set
    status = 'PRIRADENY',
    assigned_user_id = p_user_id,
    assigned_at = now()
  from candidate c
  where q.id = c.id
  returning q.id, q.code
  into v_qr;

  if not found then
    return;
  end if;

  select coalesce(array_agg(uq.qr_code), array[]::text[])
  into v_old_codes
  from public.user_qr_codes uq
  where uq.user_id = p_user_id
    and uq.active = true
    and uq.qr_code <> v_qr.code;

  update public.user_qr_codes uq
  set
    active = false,
    invalidated_by = p_assigned_by,
    invalidated_at = now(),
    note = coalesce(uq.note || ' | ', '') || coalesce(p_note, 'QR bol vymeneny.')
  where uq.user_id = p_user_id
    and uq.active = true
    and uq.qr_code <> v_qr.code;

  update public.qr_codes q
  set
    status = 'REZERVOVANY',
    assigned_user_id = p_user_id
  where q.code = any(v_old_codes)
    and q.code <> v_qr.code;

  update public.users
  set
    qr_code = v_qr.code,
    updated_at = now()
  where id = p_user_id;

  insert into public.user_qr_codes (
    user_id,
    qr_code,
    active,
    assigned_by,
    invalidated_by,
    invalidated_at,
    note
  )
  values (
    p_user_id,
    v_qr.code,
    true,
    p_assigned_by,
    null,
    null,
    coalesce(p_note, 'QR priradeny z tabulky qr_codes.')
  )
  on conflict on constraint user_qr_codes_qr_code_key do update
  set
    active = true,
    assigned_by = excluded.assigned_by,
    invalidated_by = null,
    invalidated_at = null,
    note = coalesce(public.user_qr_codes.note || ' | ', '') || excluded.note
  where public.user_qr_codes.user_id = excluded.user_id
  returning public.user_qr_codes.id
  into v_user_qr_id;

  if v_user_qr_id is null then
    raise exception 'QR_ALREADY_ASSIGNED';
  end if;

  return query
  select v_qr.id::uuid, v_qr.code::text;
end;
$$;

grant execute on function public.replace_user_qr_from_pool(uuid, text, uuid, text) to authenticated;
grant execute on function public.replace_user_qr_from_pool(uuid, text, uuid, text) to service_role;

commit;
