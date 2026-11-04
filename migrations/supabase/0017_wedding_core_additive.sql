-- Supabase-only additive wedding schema.
-- This file lives under migrations/supabase so the Neon migrator does not apply it.
-- It creates missing wedding tables, turns on row level security, removes public grants,
-- and adds foreign keys. It does not delete or rewrite existing rows.

create table if not exists public.circles (
  slug text primary key,
  payload jsonb not null,
  edit_key text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.circle_members (
  slug text not null,
  member_key text not null,
  email text not null default '',
  name text not null default '',
  role text not null,
  primary key (slug, member_key)
);
create table if not exists public.circle_auth (
  slug text primary key,
  host_code text not null,
  cohost_code text not null,
  family_codes text not null,
  guest_codes text not null,
  edit_key text not null
);
create table if not exists public.ceremony_invites (
  token text primary key,
  slug text not null,
  code_kind text not null,
  code_id text not null,
  ceremonies jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table if not exists public.couple_access (
  slug text primary key,
  bride_code text not null default '',
  bride_status text not null default '',
  bride_claimed text not null default '',
  bride_account text not null default '',
  bride_name text not null default '',
  groom_code text not null default '',
  groom_status text not null default '',
  groom_claimed text not null default '',
  groom_account text not null default '',
  groom_name text not null default ''
);
create index if not exists circle_members_slug_idx on public.circle_members (slug);
create index if not exists ceremony_invites_slug_idx on public.ceremony_invites (slug);
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_auth enable row level security;
alter table public.ceremony_invites enable row level security;
alter table public.couple_access enable row level security;
revoke all on table public.circles from anon, authenticated, public;
revoke all on table public.circle_members from anon, authenticated, public;
revoke all on table public.circle_auth from anon, authenticated, public;
revoke all on table public.ceremony_invites from anon, authenticated, public;
revoke all on table public.couple_access from anon, authenticated, public;
alter table public.circle_members add constraint circle_members_slug_fkey foreign key (slug) references public.circles (slug);
alter table public.circle_auth add constraint circle_auth_slug_fkey foreign key (slug) references public.circles (slug);
alter table public.ceremony_invites add constraint ceremony_invites_slug_fkey foreign key (slug) references public.circles (slug);
alter table public.couple_access add constraint couple_access_slug_fkey foreign key (slug) references public.circles (slug);
create table if not exists public.wedding_core_recovery (
  id text primary key,
  table_name text not null,
  row_key text not null,
  reason text not null,
  row_data jsonb not null,
  captured_at timestamptz not null default now()
);
alter table public.wedding_core_recovery enable row level security;
revoke all on table public.wedding_core_recovery from anon, authenticated, public;
