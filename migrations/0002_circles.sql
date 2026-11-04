create table if not exists circles (
  slug text primary key,
  payload jsonb not null,
  edit_key text not null,
  updated_at timestamptz not null default now()
);
