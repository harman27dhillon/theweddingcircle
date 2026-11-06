create table if not exists voice_realtime_rooms (
  slug text not null,
  provider_app text not null,
  meeting_id text not null default '',
  lease_id text not null,
  lease_until timestamptz not null,
  primary key (slug, provider_app)
);

create table if not exists voice_realtime_sessions (
  connection_id text primary key,
  slug text not null,
  member_key text not null,
  provider_app text not null,
  meeting_id text not null,
  participant_id text not null,
  mic_on boolean not null default false,
  seen_at timestamptz not null
);

create index if not exists voice_realtime_sessions_roster_idx
  on voice_realtime_sessions (slug, provider_app, seen_at);

alter table voice_realtime_rooms enable row level security;
alter table voice_realtime_sessions enable row level security;
