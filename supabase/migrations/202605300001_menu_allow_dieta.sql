begin;

alter table public.jedalny_listok
  drop constraint if exists jedalny_listok_varianta_check;

alter table public.jedalny_listok
  add constraint jedalny_listok_varianta_check
  check (varianta = any (array['MASO'::text, 'VEGE'::text, 'DIETA'::text]));

alter table public.vyber_jedal
  drop constraint if exists vyber_jedal_volba_check;

alter table public.vyber_jedal
  add constraint vyber_jedal_volba_check
  check (volba = any (array['MASO'::text, 'VEGE'::text, 'DIETA'::text]));

commit;
