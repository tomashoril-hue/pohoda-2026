begin;

create or replace function public.restore_last_user_pool_qr(
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
  v_old_codes text[];
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

  select q.id, q.code
  into v_qr
  from public.qr_codes q
  where q.assigned_user_id = p_user_id
    and exists (
      select 1
      from public.user_qr_codes own_uq
      where own_uq.user_id = p_user_id
        and own_uq.qr_code = q.code
    )
    and not exists (
      select 1
      from public.user_qr_codes active_uq
      where active_uq.user_id = p_user_id
        and active_uq.qr_code = q.code
        and active_uq.active = true
    )
    and not exists (
      select 1
      from public.user_qr_codes other_uq
      where other_uq.qr_code = q.code
        and other_uq.user_id <> p_user_id
    )
  order by q.assigned_at desc nulls last, q.created_at desc
  limit 1
  for update;

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

  update public.qr_codes q
  set
    status = 'PRIRADENY',
    assigned_user_id = p_user_id,
    assigned_at = now()
  where q.id = v_qr.id;

  update public.user_qr_codes uq
  set
    active = true,
    assigned_by = p_assigned_by,
    invalidated_by = null,
    invalidated_at = null,
    note = coalesce(uq.note || ' | ', '') || coalesce(p_note, 'Posledny databazovy QR bol obnoveny.')
  where uq.user_id = p_user_id
    and uq.qr_code = v_qr.code;

  update public.users
  set
    qr_code = v_qr.code,
    updated_at = now()
  where id = p_user_id;

  return query
  select v_qr.id::uuid, v_qr.code::text;
end;
$$;

grant execute on function public.restore_last_user_pool_qr(uuid, uuid, text) to authenticated;
grant execute on function public.restore_last_user_pool_qr(uuid, uuid, text) to service_role;

commit;
