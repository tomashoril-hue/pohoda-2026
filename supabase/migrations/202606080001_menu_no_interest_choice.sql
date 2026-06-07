begin;

alter table public.vyber_jedal
  drop constraint if exists vyber_jedal_volba_check;

alter table public.vyber_jedal
  add constraint vyber_jedal_volba_check
  check (volba = any (array['MASO'::text, 'VEGE'::text, 'DIETA'::text, 'BEZ_ZAUJMU'::text]));

commit;
