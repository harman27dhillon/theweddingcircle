create table if not exists developer_cloud_active (
  service text primary key,
  choice text not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table circle_media add column if not exists provider text not null default 'library';
alter table circle_media add column if not exists object_path text not null default '';

create table if not exists circle_media_remote (
  id text not null,
  idx integer not null,
  bytes integer not null,
  primary key (id, idx)
);

create table if not exists push_devices (
  owner_hash text primary key,
  token text not null,
  updated_at timestamptz not null default now()
);
