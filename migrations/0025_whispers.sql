create table if not exists whispers (
  id text primary key,
  slug text not null,
  parent_post_id text not null,
  parent_excerpt text not null default '',
  reply_to text,
  sender_key text not null,
  sender_name text not null,
  recipient_key text not null,
  recipient_name text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  first_revealed_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz
);

create index if not exists whispers_party on whispers (slug, sender_key, created_at desc);
create index if not exists whispers_recipient on whispers (slug, recipient_key, created_at desc);
