begin;

alter table public.registration_groups
  add column if not exists production_village_dinner boolean not null default false;

commit;
