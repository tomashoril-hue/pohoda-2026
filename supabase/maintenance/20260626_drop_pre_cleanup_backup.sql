-- POHODA 2026 drop temporary pre-cleanup backup
--
-- Run this ONLY after the production cleanup was verified and you are sure
-- the backup_pre_cleanup_20260626 schema is no longer needed.

drop schema if exists backup_pre_cleanup_20260626 cascade;
