create table if not exists seek_group_settings (
  slug text primary key,
  mode text not null default 'QUIET',
  allow_completion_announcements boolean not null default false,
  max_spontaneous_per_hour integer not null default 4,
  updated_at timestamptz not null default now()
);

create table if not exists seek_member_preferences (
  slug text not null,
  member_key text not null,
  allow_spontaneous boolean not null default false,
  allow_photo_comments boolean not null default false,
  preferred_language text,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (slug, member_key)
);

create table if not exists seek_conversation_state (
  slug text not null,
  member_key text not null,
  topic text not null default '',
  intent text not null default '',
  payload jsonb not null default '{}',
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (slug, member_key)
);

create table if not exists seek_processed_events (
  event_id text primary key,
  slug text not null,
  trigger_message_id text not null,
  status text not null,
  response_id text,
  error_code text,
  processed_at timestamptz not null default now(),
  unique (slug, trigger_message_id)
);

create table if not exists seek_pending_actions (
  id text primary key,
  slug text not null,
  member_key text not null,
  action_type text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists seek_response_history (
  id text primary key,
  slug text not null,
  member_key text,
  template_id text not null,
  category text not null,
  created_at timestamptz not null default now()
);

create table if not exists seek_private_turns (
  id text primary key,
  slug text not null,
  member_key text not null,
  query text not null,
  answer text not null,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists seek_private_member on seek_private_turns (slug, member_key, created_at desc);
create index if not exists seek_history_recent on seek_response_history (slug, created_at desc);
