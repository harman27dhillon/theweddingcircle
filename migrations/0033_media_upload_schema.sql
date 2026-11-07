-- Apply media schema once before requests use it. Existing rows are preserved.

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

alter table infra_checks add column if not exists diag text not null default '';

create table if not exists infra_purchases (
    token_hash text primary key,
    product_slot text not null,
    state text not null,
    updated_at timestamptz not null default now()
  );

create table if not exists infra_config (
    id text primary key,
    cipher text not null,
    nonce text not null,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  );

create table if not exists r2_media (
    object_key text primary key,
    slug text not null,
    purpose text not null,
    mime text not null,
    bytes integer not null,
    created_at timestamptz not null default now()
  );

create table if not exists r2_upload (
    upload_id text primary key,
    object_key text not null,
    slug text not null,
    purpose text not null,
    mime text not null,
    member_hash text not null,
    total_bytes integer not null,
    total_chunks integer not null,
    received integer not null default 0,
    flushed integer not null default 0,
    multipart_id text not null default '',
    next_part integer not null default 1,
    etags text not null default '[]',
    created_at timestamptz not null default now()
  );

alter table r2_upload add column if not exists created_at timestamptz not null default now();
