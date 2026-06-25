insert into public.app_settings (key, value)
values ('legacy_bulk_issue_enabled', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.groups
  add column if not exists registration_group_id uuid references public.registration_groups(id) on delete set null;

create index if not exists groups_registration_group_id_idx
  on public.groups(registration_group_id);

alter table public.registration_group_issue_items
  drop constraint if exists registration_group_issue_items_source_check;

alter table public.registration_group_issue_items
  add constraint registration_group_issue_items_source_check
    check (source in ('REGISTRATION_GROUP', 'FOOD_GROUP', 'SEARCH', 'QR'));
