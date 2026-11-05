-- Matches the existing application account identity; no new identity namespace.
-- Only applied by Developer setup if circle_accounts does not already exist.
create table if not exists public.circle_accounts (
  id text primary key,
  email text not null default '',
  phone text not null default '',
  name text not null default '',
  password_hash text not null,
  country text not null default '',
  firebase_uid text not null default '',
  updated_at timestamptz not null default now()
);
create unique index if not exists circle_accounts_email_idx on public.circle_accounts (email) where email <> '';
create unique index if not exists circle_accounts_phone_idx on public.circle_accounts (phone) where phone <> '';
create unique index if not exists circle_accounts_firebase_uid_idx on public.circle_accounts (firebase_uid) where firebase_uid <> '';
alter table public.circle_accounts enable row level security;
revoke all on public.circle_accounts from public, anon, authenticated;
