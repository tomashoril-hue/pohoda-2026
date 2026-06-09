alter table public.registration_group_issue_items
  drop constraint if exists registration_group_issue_items_remove_reason_check;

alter table public.registration_group_issue_items
  add constraint registration_group_issue_items_remove_reason_check
  check (
    remove_reason is null
    or remove_reason in (
      'MOVED_TO_OTHER_ISSUE',
      'NO_ENTITLEMENT',
      'NO_INTEREST',
      'ALREADY_ISSUED',
      'USER_INACTIVE',
      'USER_BLOCKED',
      'MANUAL',
      'GROUP_CANCELLED',
      'REMOVED_FROM_GROUP',
      'MOVED_TO_OTHER_GROUP'
    )
  );
