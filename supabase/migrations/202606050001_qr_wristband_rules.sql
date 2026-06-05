begin;

create table if not exists public.personnel_qr_wristband_settings (
  id text primary key default 'DEFAULT',
  enabled boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint personnel_qr_wristband_settings_id_check
    check (id = 'DEFAULT')
);

create table if not exists public.personnel_qr_wristband_ranges (
  id uuid primary key default gen_random_uuid(),
  type_code text not null,
  series_from integer not null,
  series_to integer not null,
  active boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint personnel_qr_wristband_ranges_type_check
    check (type_code ~ '^[0-9]{2}$'),
  constraint personnel_qr_wristband_ranges_series_check
    check (series_from between 1 and 999 and series_to between 1 and 999 and series_to >= series_from)
);

create unique index if not exists personnel_qr_wristband_ranges_type_key
  on public.personnel_qr_wristband_ranges(type_code);

create or replace function public.touch_personnel_qr_wristband_ranges_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_personnel_qr_wristband_ranges_updated_at
  on public.personnel_qr_wristband_ranges;

create trigger trg_personnel_qr_wristband_ranges_updated_at
before update on public.personnel_qr_wristband_ranges
for each row
execute function public.touch_personnel_qr_wristband_ranges_updated_at();

insert into public.personnel_qr_wristband_settings (id, enabled)
values ('DEFAULT', true)
on conflict (id) do nothing;

insert into public.personnel_qr_wristband_ranges (type_code, series_from, series_to, active)
values
  ('42', 1, 520, true),
  ('43', 1, 340, true),
  ('44', 1, 22, true),
  ('45', 1, 20, true),
  ('46', 1, 32, true),
  ('47', 1, 18, true),
  ('48', 1, 30, true),
  ('49', 1, 6, true),
  ('50', 1, 36, true),
  ('51', 1, 46, true),
  ('52', 1, 12, true),
  ('53', 1, 44, true),
  ('54', 1, 4, true),
  ('55', 1, 20, true),
  ('56', 1, 6, true),
  ('57', 1, 14, true),
  ('58', 1, 4, true),
  ('59', 1, 10, true),
  ('60', 1, 12, true)
on conflict (type_code) do update
set
  series_from = excluded.series_from,
  series_to = excluded.series_to,
  active = excluded.active,
  updated_at = now();

commit;
