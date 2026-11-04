create table if not exists chat_polls (
  id text primary key,
  slug text not null,
  post_id text not null,
  author_key text not null,
  author_name text not null,
  question text not null,
  multiple boolean not null default false,
  anonymous boolean not null default false,
  change_votes boolean not null default true,
  add_options boolean not null default false,
  results text not null default 'immediate',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists chat_polls_slug on chat_polls (slug, created_at desc);

create table if not exists chat_poll_options (
  id text primary key,
  poll_id text not null,
  label text not null,
  sort_index integer not null default 0
);

create index if not exists chat_poll_options_poll on chat_poll_options (poll_id, sort_index);

create table if not exists chat_poll_votes (
  poll_id text not null,
  option_id text not null,
  member_key text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, member_key)
);
