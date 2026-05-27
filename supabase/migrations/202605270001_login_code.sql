alter table public.login_tokens
  add column if not exists login_code_hash text,
  add column if not exists login_code_attempts integer not null default 0,
  add column if not exists login_code_last_attempt_at timestamp with time zone;

create index if not exists login_tokens_email_active_idx
  on public.login_tokens(email, expires_at desc)
  where used_at is null;
