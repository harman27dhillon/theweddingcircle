create table if not exists realtime_meetings (
  id bigserial primary key,
  slug text not null,
  ceremony_id text not null,
  meeting_id text not null default '',
  host_peer text not null default '',
  status text not null default 'active',
  recording_id text not null default '',
  recording_status text not null default '',
  recording_seconds integer,
  object_key text not null default '',
  replay_id text not null default '',
  recording_error text not null default '',
  participant_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, ceremony_id)
);

create unique index if not exists realtime_meetings_meeting_id
  on realtime_meetings (meeting_id)
  where meeting_id <> '';

create table if not exists realtime_webhook_deliveries (
  delivery_id text primary key,
  event_name text not null default '',
  received_at timestamptz not null default now()
);

create table if not exists r2_media (
  object_key text primary key,
  slug text not null,
  purpose text not null,
  mime text not null,
  bytes integer not null,
  created_at timestamptz not null default now()
);
