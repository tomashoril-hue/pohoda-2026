alter table public.vyber_jedal
  add column if not exists updated_at timestamp with time zone not null default now();

alter table public.user_qr_codes
  add column if not exists updated_at timestamp with time zone not null default now();

create or replace function public.touch_offline_delta_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_vyber_jedal_offline_delta_updated_at
  on public.vyber_jedal;

create trigger trg_vyber_jedal_offline_delta_updated_at
before update on public.vyber_jedal
for each row
execute function public.touch_offline_delta_updated_at();

drop trigger if exists trg_user_qr_codes_offline_delta_updated_at
  on public.user_qr_codes;

create trigger trg_user_qr_codes_offline_delta_updated_at
before update on public.user_qr_codes
for each row
execute function public.touch_offline_delta_updated_at();

create index if not exists vyber_jedal_date_meal_updated_idx
  on public.vyber_jedal(datum, typ_jedla, updated_at);

create index if not exists user_qr_codes_user_updated_idx
  on public.user_qr_codes(user_id, updated_at);
