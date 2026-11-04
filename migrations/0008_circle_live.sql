create table if not exists circle_live (
  slug text primary key,
  host_name text not null,
  host_peer text not null,
  allow_codes text not null default '',
  is_private boolean not null default false,
  seen_at timestamptz not null default now()
);
