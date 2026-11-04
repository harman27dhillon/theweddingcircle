create table if not exists wedding_vouchers (
  id text primary key,
  code_hash text not null unique,
  code_hint text not null,
  status text not null default 'unused',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  wedding_id text,
  wedding_slug text,
  created_by text not null default '',
  revoked_at timestamptz
);

create index if not exists wedding_vouchers_status_idx on wedding_vouchers (status);
