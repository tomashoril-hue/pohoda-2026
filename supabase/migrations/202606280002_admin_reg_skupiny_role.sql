begin;

alter table public.app_user_roles
  drop constraint if exists app_user_roles_role_check;

alter table public.app_user_roles
  add constraint app_user_roles_role_check
  check (role in (
    'ADMIN',
    'PERSONALISTA',
    'ADMIN_VYDAJ',
    'VYDAJ',
    'GROUP_CREATOR',
    'WRISTBAND_KIOSK',
    'MENU_KIOSK',
    'OFFLINE_OBSLUHA',
    'SAMOSTATNE_OBJEDNAVANIE_STRAVY',
    'ADMIN_REG_SKUPINY'
  ));

commit;
