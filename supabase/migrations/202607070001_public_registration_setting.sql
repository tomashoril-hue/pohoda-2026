begin;

insert into public.app_settings (key, value)
values ('public_registration_enabled', 'false'::jsonb)
on conflict (key) do nothing;

commit;
