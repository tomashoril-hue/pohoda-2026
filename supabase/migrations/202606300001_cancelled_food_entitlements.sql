begin;

alter table public.user_food_entitlements
  add column if not exists cancelled_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.users(id) on delete set null;

create index if not exists user_food_entitlements_cancelled_reason_idx
  on public.user_food_entitlements(cancelled_reason)
  where cancelled_reason is not null;

commit;
