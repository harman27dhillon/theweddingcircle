create table if not exists circle_media (
  id text primary key,
  slug text not null,
  mime text not null,
  chunks integer not null,
  updated_at timestamptz not null default now()
);

create table if not exists circle_media_part (
  id text not null,
  idx integer not null,
  data text not null,
  primary key (id, idx)
);
