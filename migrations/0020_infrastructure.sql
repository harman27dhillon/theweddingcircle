create table if not exists infra_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists infra_checks (
  provider text primary key,
  state text not null,
  detail text not null default '',
  fingerprint text not null default '',
  checked_at timestamptz not null default now()
);

create table if not exists infra_purchases (
  token_hash text primary key,
  product_slot text not null,
  state text not null,
  updated_at timestamptz not null default now()
);
