alter table circles add column if not exists created_at timestamptz;
alter table circles add column if not exists expires_at timestamptz;
alter table circles add column if not exists media_retention_until timestamptz;

create table if not exists circle_expiry_reminders (
  slug text not null,
  slot timestamptz not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (slug, slot)
);

create table if not exists circle_retention_payments (
  id text primary key,
  slug text not null,
  amount_paise integer not null,
  status text not null,
  reference text not null unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists circle_lifecycle_audit (
  id text primary key,
  slug text not null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
