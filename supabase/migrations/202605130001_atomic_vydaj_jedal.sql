begin;

create or replace function public.issue_individual_meal_atomic(
  p_user_id uuid,
  p_datum date,
  p_typ_jedla text,
  p_issued_by uuid,
  p_group_id uuid default null,
  p_hromadny_vydaj_id uuid default null,
  p_planned_item_ids uuid[] default array[]::uuid[],
  p_volba text default null,
  p_sposob text default 'INDIVIDUALNE',
  p_qr_code text default null,
  p_source text default 'QR',
  p_note text default null
)
returns table (
  issued_id uuid,
  issued_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_ids uuid[] := coalesce(p_planned_item_ids, array[]::uuid[]);
  v_item_count integer := coalesce(cardinality(p_planned_item_ids), 0);
  v_locked_count integer := 0;
  v_updated_count integer := 0;
begin
  if p_user_id is null or p_datum is null or p_typ_jedla is null or p_issued_by is null then
    raise exception 'REQUIRED_ARGUMENT_MISSING';
  end if;

  if p_typ_jedla not in ('OBED', 'VECERA') then
    raise exception 'INVALID_MEAL_TYPE';
  end if;

  if p_sposob <> 'INDIVIDUALNE' then
    raise exception 'INVALID_ISSUE_METHOD';
  end if;

  if p_volba is not null and p_volba not in ('MASO', 'VEGE', 'DIETA') then
    raise exception 'INVALID_FOOD_CHOICE';
  end if;

  if v_item_count > 0 then
    with locked as (
      select p.id
      from public.hromadny_vydaj_polozky p
      where p.id = any(v_item_ids)
        and p.user_id = p_user_id
        and p.status = 'PLANNED'
      for update
    )
    select count(*) into v_locked_count
    from locked;

    if v_locked_count <> v_item_count then
      raise exception 'PLANNED_ITEMS_CHANGED';
    end if;
  end if;

  insert into public.vydaj_jedal (
    user_id,
    group_id,
    hromadny_vydaj_id,
    datum,
    typ_jedla,
    volba,
    sposob,
    status,
    issued_by,
    qr_code,
    source,
    note
  )
  values (
    p_user_id,
    p_group_id,
    p_hromadny_vydaj_id,
    p_datum,
    p_typ_jedla,
    p_volba,
    p_sposob,
    'VYDANE',
    p_issued_by,
    p_qr_code,
    p_source,
    p_note
  )
  returning id, vydaj_jedal.issued_at
  into issued_id, issued_at;

  if v_item_count > 0 then
    with updated as (
      update public.hromadny_vydaj_polozky p
      set
        status = 'INDIVIDUAL_ISSUED',
        updated_at = now()
      where p.id = any(v_item_ids)
        and p.user_id = p_user_id
        and p.status = 'PLANNED'
      returning p.id
    )
    select count(*) into v_updated_count
    from updated;

    if v_updated_count <> v_item_count then
      raise exception 'PLANNED_ITEMS_UPDATE_FAILED';
    end if;
  end if;

  return next;
end;
$$;

create or replace function public.issue_bulk_meal_atomic(
  p_hromadny_vydaj_id uuid,
  p_group_id uuid,
  p_datum date,
  p_typ_jedla text,
  p_issued_by uuid,
  p_qr_user_id uuid default null,
  p_qr_code text default null,
  p_items jsonb default '[]'::jsonb
)
returns table (
  first_issued_id uuid,
  first_issued_at timestamp with time zone,
  issued_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_ids uuid[];
  v_item_count integer := 0;
  v_locked_count integer := 0;
  v_updated_count integer := 0;
begin
  if p_hromadny_vydaj_id is null or p_group_id is null or p_datum is null or p_typ_jedla is null or p_issued_by is null then
    raise exception 'REQUIRED_ARGUMENT_MISSING';
  end if;

  if p_typ_jedla not in ('OBED', 'VECERA') then
    raise exception 'INVALID_MEAL_TYPE';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_ITEMS';
  end if;

  select
    coalesce(array_agg(x.planned_item_id), array[]::uuid[]),
    count(*)
  into v_item_ids, v_item_count
  from jsonb_to_recordset(p_items) as x(
    planned_item_id uuid,
    user_id uuid,
    volba text
  );

  if v_item_count = 0 then
    raise exception 'NO_ITEMS_TO_ISSUE';
  end if;

  if (
    select count(distinct item_id)
    from unnest(v_item_ids) as item_ids(item_id)
  ) <> v_item_count then
    raise exception 'DUPLICATE_PLANNED_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as x(
      planned_item_id uuid,
      user_id uuid,
      volba text
    )
    where x.planned_item_id is null
      or x.user_id is null
      or (x.volba is not null and x.volba not in ('MASO', 'VEGE', 'DIETA'))
  ) then
    raise exception 'INVALID_ITEM_DATA';
  end if;

  with locked as (
    select p.id
    from public.hromadny_vydaj_polozky p
    where p.hromadny_vydaj_id = p_hromadny_vydaj_id
      and p.id = any(v_item_ids)
      and p.status = 'PLANNED'
    for update
  )
  select count(*) into v_locked_count
  from locked;

  if v_locked_count <> v_item_count then
    raise exception 'PLANNED_ITEMS_CHANGED';
  end if;

  with input_items as (
    select *
    from jsonb_to_recordset(p_items) as x(
      planned_item_id uuid,
      user_id uuid,
      volba text
    )
  ),
  inserted as (
    insert into public.vydaj_jedal (
      user_id,
      group_id,
      hromadny_vydaj_id,
      datum,
      typ_jedla,
      volba,
      sposob,
      status,
      issued_by,
      qr_code,
      source,
      note
    )
    select
      i.user_id,
      p_group_id,
      p_hromadny_vydaj_id,
      p_datum,
      p_typ_jedla,
      i.volba,
      'HROMADNE',
      'VYDANE',
      p_issued_by,
      case when i.user_id = p_qr_user_id then p_qr_code else null end,
      'QR',
      'Hromadny vydaj cez QR opravnenej osoby.'
    from input_items i
    returning id, vydaj_jedal.issued_at
  )
  select
    (array_agg(id order by issued_at asc))[1],
    min(issued_at),
    count(*)
  into first_issued_id, first_issued_at, issued_count
  from inserted;

  if issued_count <> v_item_count then
    raise exception 'ISSUED_ROWS_MISMATCH';
  end if;

  with updated as (
    update public.hromadny_vydaj_polozky p
    set
      status = 'BULK_ISSUED',
      updated_at = now()
    where p.hromadny_vydaj_id = p_hromadny_vydaj_id
      and p.id = any(v_item_ids)
      and p.status = 'PLANNED'
    returning p.id
  )
  select count(*) into v_updated_count
  from updated;

  if v_updated_count <> v_item_count then
    raise exception 'PLANNED_ITEMS_UPDATE_FAILED';
  end if;

  return next;
end;
$$;

grant execute on function public.issue_individual_meal_atomic(uuid, date, text, uuid, uuid, uuid, uuid[], text, text, text, text, text) to authenticated;
grant execute on function public.issue_individual_meal_atomic(uuid, date, text, uuid, uuid, uuid, uuid[], text, text, text, text, text) to service_role;

grant execute on function public.issue_bulk_meal_atomic(uuid, uuid, date, text, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.issue_bulk_meal_atomic(uuid, uuid, date, text, uuid, uuid, text, jsonb) to service_role;

commit;
