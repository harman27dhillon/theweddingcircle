create table if not exists developer_secret_vault (
  service text primary key,
  cipher text not null,
  nonce text not null,
  updated_at timestamptz not null default now()
);

create table if not exists affiliate_link_status (
  service text primary key,
  state text not null,
  detail text not null default '',
  checked_at timestamptz not null default now()
);
