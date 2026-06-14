create table if not exists public.user_privacy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  consent_version text not null,
  privacy_policy_url text not null,
  consent_text text not null,
  accepted_at timestamp with time zone not null default now(),
  ip_address text,
  user_agent text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  constraint user_privacy_consents_user_version_key unique (user_id, consent_version)
);

create index if not exists user_privacy_consents_user_active_idx
  on public.user_privacy_consents(user_id, active);

create index if not exists user_privacy_consents_version_idx
  on public.user_privacy_consents(consent_version);
