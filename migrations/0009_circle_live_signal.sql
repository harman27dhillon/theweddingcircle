create table if not exists circle_live_signal (
  id bigserial primary key,
  slug text not null,
  sender text not null,
  recipient text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists circle_live_signal_slug_id on circle_live_signal (slug, id);
