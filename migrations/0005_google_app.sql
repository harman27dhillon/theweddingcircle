create table if not exists google_app (
  id text primary key,
  client_id text not null,
  client_secret text not null,
  redirect_uri text not null default '',
  updated_at timestamptz not null default now()
);
