-- Supabase is the only persistent application database. Normalize any
-- leftover migration flag so no runtime or operator view can imply a Neon route.
alter table public.developer_core_migration
  alter column cutover set default 'supabase';

update public.developer_core_migration
set cutover = 'supabase'
where cutover is distinct from 'supabase';
