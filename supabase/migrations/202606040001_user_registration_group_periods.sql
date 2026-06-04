begin;

create extension if not exists btree_gist;

create table if not exists public.user_registration_group_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  registration_group_id uuid not null references public.registration_groups(id) on delete restrict,
  valid_from date not null,
  valid_to date,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_registration_group_periods_date_check
    check (valid_to is null or valid_to >= valid_from)
);

create index if not exists user_registration_group_periods_user_idx
  on public.user_registration_group_periods(user_id, valid_from desc);

create index if not exists user_registration_group_periods_group_idx
  on public.user_registration_group_periods(registration_group_id, valid_from desc);

alter table public.user_registration_group_periods
  drop constraint if exists user_registration_group_periods_no_overlap;

alter table public.user_registration_group_periods
  add constraint user_registration_group_periods_no_overlap
  exclude using gist (
    user_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  );

create or replace function public.touch_user_registration_group_periods_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_user_registration_group_periods_updated_at
  on public.user_registration_group_periods;

create trigger trg_user_registration_group_periods_updated_at
before update on public.user_registration_group_periods
for each row
execute function public.touch_user_registration_group_periods_updated_at();

insert into public.user_registration_group_periods (
  user_id,
  registration_group_id,
  valid_from,
  valid_to,
  note,
  created_by
)
select
  u.id,
  u.registration_group_id,
  current_date,
  null,
  coalesce(nullif(trim(u.registration_group_note), ''), 'Povodne aktualne zaradenie.'),
  null
from public.users u
where u.registration_group_id is not null
  and not exists (
    select 1
    from public.user_registration_group_periods p
    where p.user_id = u.id
      and p.valid_from <= current_date
      and (p.valid_to is null or p.valid_to >= current_date)
  );

commit;
