begin;

alter table public.print_jobs
  drop constraint if exists print_jobs_status_check;

update public.print_jobs
set status = lower(trim(status))
where status is not null
  and status <> lower(trim(status));

update public.print_jobs
set status = case
  when status in ('done', 'complete', 'completed', 'success') then 'printed'
  when status in ('started', 'running', 'processing', 'printing') then 'printing'
  when status in ('failed', 'fail', 'chyba', 'error') then 'failed'
  when status in ('pending', 'printing', 'printed', 'failed') then status
  else 'failed'
end;

alter table public.print_jobs
  add constraint print_jobs_status_check
  check (status in ('pending', 'printing', 'printed', 'failed'));

commit;
