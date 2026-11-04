create table if not exists infra_config (
  id text primary key,
  cipher text not null,
  nonce text not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
