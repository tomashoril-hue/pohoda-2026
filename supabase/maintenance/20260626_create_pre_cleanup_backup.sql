-- POHODA 2026 pre-cleanup backup
--
-- Run this BEFORE 20260626_full_cleanup_execute.sql.
-- It copies all current public tables into backup_pre_cleanup_20260626.
-- The backup is meant as a temporary rollback/reference copy and can be
-- dropped after the production cleanup is verified.

do $$
declare
  v_backup_schema text := 'backup_pre_cleanup_20260626';
  v_table record;
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = v_backup_schema
  ) then
    raise exception 'Backup schema % already exists. Stop here unless you intentionally want to drop the old backup first.', v_backup_schema;
  end if;

  execute format('create schema %I', v_backup_schema);

  execute format(
    'create table %I._backup_info (
      created_at timestamptz not null default now(),
      source_schema text not null,
      note text not null
    )',
    v_backup_schema
  );

  execute format(
    'insert into %I._backup_info (source_schema, note) values (%L, %L)',
    v_backup_schema,
    'public',
    'Pre-cleanup backup before keeping only selected admin/personnel accounts and regenerating QR pool.'
  );

  for v_table in
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  loop
    execute format(
      'create table %I.%I as table public.%I with data',
      v_backup_schema,
      v_table.tablename,
      v_table.tablename
    );
  end loop;

  execute format(
    'create table %I._backup_table_counts (
      table_name text primary key,
      row_count bigint not null
    )',
    v_backup_schema
  );

  for v_table in
    select tablename
    from pg_tables
    where schemaname = v_backup_schema
      and tablename not in ('_backup_info', '_backup_table_counts')
    order by tablename
  loop
    execute format(
      'insert into %I._backup_table_counts (table_name, row_count) select %L, count(*) from %I.%I',
      v_backup_schema,
      v_table.tablename,
      v_backup_schema,
      v_table.tablename
    );
  end loop;
end $$;

select table_name, row_count
from backup_pre_cleanup_20260626._backup_table_counts
order by table_name;
