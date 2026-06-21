create table if not exists public.offline_issue_events_server (
  id uuid primary key default gen_random_uuid(),
  offline_event_id text not null unique,
  device_id text not null,
  snapshot_id text not null,
  operation text not null,
  issue_action text,
  qr_code text,
  entitlement_id text,
  person_id uuid,
  registration_group_issue_id uuid references public.registration_group_issues(id) on delete set null,
  issued_person_ids uuid[] not null default array[]::uuid[],
  issued_count integer not null default 0,
  choice_summary jsonb not null default '{}'::jsonb,
  meal_date date not null,
  meal_type text not null,
  issue_location text,
  created_at_offline timestamp with time zone,
  received_at_server timestamp with time zone not null default now(),
  prepared_by_user_id uuid references public.users(id) on delete set null,
  synced_by uuid references public.users(id) on delete set null,
  result_status text not null,
  conflict_type text,
  conflict_payload jsonb,
  created_issue_ids uuid[] not null default array[]::uuid[],
  target_offline_event_id text,
  constraint offline_issue_events_server_operation_check
    check (operation in ('ISSUE', 'CANCEL_ISSUE')),
  constraint offline_issue_events_server_issue_action_check
    check (issue_action is null or issue_action in ('INDIVIDUAL', 'REGISTRATION_GROUP_BULK')),
  constraint offline_issue_events_server_meal_type_check
    check (meal_type in ('OBED', 'VECERA')),
  constraint offline_issue_events_server_result_status_check
    check (result_status in ('SYNCED', 'CONFLICT', 'FAILED_RETRY', 'IGNORED_DUPLICATE'))
);

create index if not exists offline_issue_events_server_snapshot_idx
  on public.offline_issue_events_server(snapshot_id);

create index if not exists offline_issue_events_server_device_idx
  on public.offline_issue_events_server(device_id);

create index if not exists offline_issue_events_server_result_idx
  on public.offline_issue_events_server(result_status);

create table if not exists public.offline_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  offline_event_id text not null,
  device_id text not null,
  snapshot_id text not null,
  qr_code text,
  person_id uuid references public.users(id) on delete set null,
  meal_date date,
  meal_type text,
  issue_location text,
  conflict_type text not null,
  conflict_payload jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN',
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text,
  constraint offline_sync_conflicts_status_check
    check (status in ('OPEN', 'RESOLVED'))
);

create index if not exists offline_sync_conflicts_status_idx
  on public.offline_sync_conflicts(status, created_at desc);

create index if not exists offline_sync_conflicts_event_idx
  on public.offline_sync_conflicts(offline_event_id);
