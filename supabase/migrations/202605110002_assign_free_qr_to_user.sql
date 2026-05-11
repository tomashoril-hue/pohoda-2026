begin;

create or replace function public.assign_free_qr_to_user(
  p_user_id uuid,
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
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = p_user_id
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
    note
  )
  values (
    p_user_id,
    v_qr.code,
    true,
    p_assigned_by,
    coalesce(p_note, 'Priradene z tabulky qr_codes.')
  )
  on conflict on constraint user_qr_codes_qr_code_key do nothing;

  if not exists (
    select 1
    from public.user_qr_codes uq
    where uq.qr_code = v_qr.code
      and uq.user_id = p_user_id
  ) then
    raise exception 'QR_ALREADY_ASSIGNED';
  end if;

  return query
  select v_qr.id::uuid, v_qr.code::text;
end;
$$;

grant execute on function public.assign_free_qr_to_user(uuid, uuid, text) to authenticated;
grant execute on function public.assign_free_qr_to_user(uuid, uuid, text) to service_role;

commit;
