-- Developer Center only. Applied explicitly by the authenticated setup action.
create table if not exists public.wc_developer_verification (
  id uuid primary key,
  checked_at timestamptz not null default now()
);
alter table public.wc_developer_verification enable row level security;
revoke all on public.wc_developer_verification from public, anon, authenticated;
