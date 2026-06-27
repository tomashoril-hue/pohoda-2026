begin;

create or replace function public.assign_free_qr_to_users_bulk(
  p_user_ids uuid[],
  p_assigned_by uuid default null,
  p_note text default null
)
returns table (
  user_id uuid,
  qr_code_id uuid,
  qr_code text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_requested integer;
  v_available integer;
begin
  v_requested := coalesce(array_length(p_user_ids, 1), 0);

  if v_requested = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_user_ids) as input_user(user_id)
    left join public.users u on u.id = input_user.user_id
    where input_user.user_id is null
       or u.id is null
  ) then
    raise exception 'USER_NOT_FOUND';
  end if;

  create temporary table _bulk_qr_assignment (
    user_id uuid primary key,
    qr_code_id uuid not null,
    qr_code text not null
  ) on commit drop;

  with input_users as (
    select input_user.user_id, input_user.ord
    from unnest(p_user_ids) with ordinality as input_user(user_id, ord)
  ),
  locked_candidates as (
    select
      q.id,
      q.code,
      q.created_at
    from public.qr_codes q
    where q.status = 'VOLNY'
      and q.assigned_user_id is null
      and not exists (
        select 1
        from public.user_qr_codes uq
        where uq.qr_code = q.code
      )
    order by q.created_at asc, q.id asc
    limit v_requested
    for update skip locked
  ),
  candidates as (
    select
      locked_candidates.id,
      locked_candidates.code,
      row_number() over (order by locked_candidates.created_at asc, locked_candidates.id asc) as ord
    from locked_candidates
  )
  insert into _bulk_qr_assignment (user_id, qr_code_id, qr_code)
  select input_users.user_id, candidates.id, candidates.code
  from input_users
  join candidates on candidates.ord = input_users.ord;

  select count(*) into v_available from _bulk_qr_assignment;

  if v_available <> v_requested then
    raise exception 'NO_FREE_QR_AVAILABLE';
  end if;

  update public.qr_codes q
  set
    status = 'PRIRADENY',
    assigned_user_id = assignment.user_id,
    assigned_at = now()
  from _bulk_qr_assignment assignment
  where q.id = assignment.qr_code_id;

  update public.users u
  set
    qr_code = assignment.qr_code,
    updated_at = now()
  from _bulk_qr_assignment assignment
  where u.id = assignment.user_id;

  insert into public.user_qr_codes (
    user_id,
    qr_code,
    active,
    assigned_by,
    note
  )
  select
    assignment.user_id,
    assignment.qr_code,
    true,
    p_assigned_by,
    coalesce(p_note, 'Priradene z tabulky qr_codes.')
  from _bulk_qr_assignment assignment
  on conflict on constraint user_qr_codes_qr_code_key do nothing;

  if exists (
    select 1
    from _bulk_qr_assignment assignment
    where not exists (
      select 1
      from public.user_qr_codes uq
      where uq.qr_code = assignment.qr_code
        and uq.user_id = assignment.user_id
    )
  ) then
    raise exception 'QR_ALREADY_ASSIGNED';
  end if;

  return query
  select
    assignment.user_id,
    assignment.qr_code_id,
    assignment.qr_code
  from _bulk_qr_assignment assignment
  order by array_position(p_user_ids, assignment.user_id);
end;
$function$;

grant execute on function public.assign_free_qr_to_users_bulk(uuid[], uuid, text) to authenticated;
grant execute on function public.assign_free_qr_to_users_bulk(uuid[], uuid, text) to service_role;

commit;
