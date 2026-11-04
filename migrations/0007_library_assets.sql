create table if not exists library_assets (
  asset_id text primary key,
  name text not null,
  category text not null,
  public_path text not null unique,
  mime text not null default 'image/jpeg',
  active boolean not null default true,
  builtin boolean not null default false,
  replaced boolean not null default false,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists library_blobs (
  asset_id text primary key references library_assets(asset_id) on delete cascade,
  mime text not null,
  data text not null
);

create table if not exists library_retired (
  asset_id text primary key,
  retired_at timestamptz not null default now()
);
