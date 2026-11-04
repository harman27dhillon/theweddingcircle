create table if not exists music_tracks (
  track_id text primary key,
  title text not null,
  mime text not null,
  bytes integer not null,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists music_blobs (
  track_id text primary key references music_tracks(track_id) on delete cascade,
  mime text not null,
  data text not null
);
