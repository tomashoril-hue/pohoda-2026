create table if not exists public.offline_delta_events (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id text,
  operation text not null,
  user_id uuid references public.users(id) on delete set null,
  issue_id uuid,
  datum date,
  typ_jedla text,
  created_at timestamp with time zone not null default now()
);

create index if not exists offline_delta_events_created_idx
  on public.offline_delta_events(created_at);

create index if not exists offline_delta_events_food_idx
  on public.offline_delta_events(datum, typ_jedla, created_at);

create or replace function public.log_user_food_entitlement_delete_for_offline_delta()
returns trigger
language plpgsql
as $function$
begin
  insert into public.offline_delta_events (
    entity_table,
    entity_id,
    operation,
    user_id,
    datum,
    typ_jedla
  )
  values
    (
      'user_food_entitlements',
      old.user_id::text || ':' || old.datum::text,
      'DELETE',
      old.user_id,
      old.datum,
      null
    );

  return old;
end;
$function$;

drop trigger if exists trg_user_food_entitlements_offline_delta_delete
  on public.user_food_entitlements;

create trigger trg_user_food_entitlements_offline_delta_delete
after delete on public.user_food_entitlements
for each row
execute function public.log_user_food_entitlement_delete_for_offline_delta();
