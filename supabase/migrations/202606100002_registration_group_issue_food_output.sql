alter table public.vydaj_jedal
  add column if not exists registration_group_issue_id uuid
  references public.registration_group_issues(id) on delete set null;

create index if not exists vydaj_jedal_registration_group_issue_idx
  on public.vydaj_jedal(registration_group_issue_id);

alter table public.registration_group_issue_items
  drop constraint if exists registration_group_issue_items_status_check;

alter table public.registration_group_issue_items
  add constraint registration_group_issue_items_status_check
  check (status in ('PLANNED', 'REMOVED', 'BULK_ISSUED', 'INDIVIDUAL_ISSUED'));
