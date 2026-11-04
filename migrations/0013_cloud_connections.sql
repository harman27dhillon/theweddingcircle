create table if not exists developer_cloud_public (
  provider text primary key,
  config jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists developer_cloud_tests (
  provider text not null,
  capability text not null,
  state text not null,
  detail text not null default '',
  checked_at timestamptz not null default now(),
  primary key (provider, capability)
);

create table if not exists developer_cloud_requests (
  service text primary key,
  choice text not null,
  note text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
