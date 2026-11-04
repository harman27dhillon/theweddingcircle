create table if not exists voice_sessions (
  slug text not null,
  member_key text not null,
  name text not null default '',
  connected boolean not null default false,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (slug, member_key)
);

create index if not exists voice_sessions_seen_idx on voice_sessions (seen_at);
