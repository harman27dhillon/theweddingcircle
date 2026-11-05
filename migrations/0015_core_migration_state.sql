create table if not exists developer_core_migration (
  id text primary key,
  phase text not null default 'idle',
  detail text not null default '',
  source_counts jsonb not null default '{}',
  target_counts jsonb not null default '{}',
  cutover text not null default 'supabase',
  validated boolean not null default false,
  updated_at timestamptz not null default now()
);
