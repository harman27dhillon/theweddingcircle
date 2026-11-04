create table if not exists developer_sessions (
  id text primary key,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists developer_audit (
  id text primary key,
  email text not null,
  command text not null,
  interpretation text not null default '',
  level text not null,
  action text not null default '',
  result text not null,
  error text not null default '',
  files text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists developer_flags (
  key text primary key,
  enabled boolean not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists developer_config (
  key text primary key,
  value text not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists developer_errors (
  id text primary key,
  source text not null,
  message text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists developer_proposals (
  id text primary key,
  email text not null,
  command text not null,
  level text not null,
  kind text not null,
  summary text not null,
  reason text not null default '',
  side_effects text not null default '',
  risk text not null default '',
  patch jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  validation text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists developer_revisions (
  id text primary key,
  proposal_id text not null,
  path text not null,
  before_text text not null,
  created_at timestamptz not null default now()
);
