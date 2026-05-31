alter table public.hromadny_vydaj_polozky
  drop constraint if exists hromadny_vydaj_polozky_volba_check;

alter table public.hromadny_vydaj_polozky
  add constraint hromadny_vydaj_polozky_volba_check
  check (volba is null or volba = any (array['MASO'::text, 'VEGE'::text, 'DIETA'::text]));
