delete from public.hromadny_vydaj_polozky
where status = 'REMOVED'
  and remove_reason = 'MANUAL';
