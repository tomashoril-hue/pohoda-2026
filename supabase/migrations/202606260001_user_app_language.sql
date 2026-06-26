alter table public.users
  add column if not exists app_language text not null default 'SK';

alter table public.users
  drop constraint if exists users_app_language_check;

alter table public.users
  add constraint users_app_language_check
  check (app_language in ('SK', 'EN'));
