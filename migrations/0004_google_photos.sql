create table if not exists google_connections (
  id text primary key,
  google_sub text not null unique,
  email text not null,
  name text not null default '',
  refresh_token text not null,
  albums jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists google_media (
  media_item_id text primary key,
  connection_id text not null,
  album_id text not null,
  slug text not null,
  mime text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists google_uploads (
  id text primary key,
  connection_id text not null,
  upload_url text not null,
  access_token text not null,
  mime text not null,
  size bigint not null,
  file_name text not null,
  slug text not null,
  created_at timestamptz not null default now()
);
