begin;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('legacy_food_groups_enabled', 'false'::jsonb)
on conflict (key) do nothing;

commit;
