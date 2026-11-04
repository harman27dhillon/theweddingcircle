create table if not exists ceremony_invites (
  token text primary key,
  slug text not null,
  code_kind text not null,
  code_id text not null,
  ceremonies jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
