alter table public.vydaj_jedal
  drop constraint if exists vydaj_jedal_volba_check;

alter table public.vydaj_jedal
  add constraint vydaj_jedal_volba_check
  check (volba is null or volba = any (array['MASO'::text, 'VEGE'::text, 'DIETA'::text]));
