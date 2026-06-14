alter table public.users
  add column if not exists account_type text not null default 'PERSON';

alter table public.users
  drop constraint if exists users_account_type_check;

alter table public.users
  add constraint users_account_type_check
  check (account_type in ('PERSON', 'TECHNICAL'));

create index if not exists users_account_type_idx
  on public.users(account_type);
