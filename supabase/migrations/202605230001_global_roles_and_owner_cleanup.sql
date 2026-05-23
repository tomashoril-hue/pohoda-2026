begin;

update public.group_members
set role = 'MANAGER'
where role = 'OWNER';

alter table public.group_members
  drop constraint if exists group_members_role_check;

alter table public.group_members
  add constraint group_members_role_check
  check (role in ('MEMBER', 'POVERENY', 'MANAGER'));

alter table public.app_user_roles
  drop constraint if exists app_user_roles_role_check;

alter table public.app_user_roles
  add constraint app_user_roles_role_check
  check (role in ('ADMIN', 'PERSONALISTA', 'ADMIN_VYDAJ', 'VYDAJ'));

commit;
