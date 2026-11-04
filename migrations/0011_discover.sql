create table if not exists discover_bots (
  id text primary key,
  name text not null,
  specialization text not null,
  enabled boolean not null default false,
  keywords text not null default '',
  categories text not null default '',
  schedule_enabled boolean not null default false,
  schedule_hours integer not null default 24,
  max_results integer not null default 24,
  freshness_days integer not null default 14,
  moderate boolean not null default true,
  ranking_note text not null default '',
  last_run_at timestamptz,
  last_success_at timestamptz,
  next_run_at timestamptz,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists discover_runs (
  id text primary key,
  bot_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  found integer not null default 0,
  error text not null default '',
  trigger text not null default 'manual'
);

create index if not exists discover_runs_bot_idx on discover_runs (bot_id, started_at desc);

create table if not exists discover_products (
  id text primary key,
  source text not null,
  source_product_id text not null,
  source_label text not null,
  source_url text not null,
  name text not null,
  description text not null default '',
  image_url text not null default '',
  price_amount text not null default '',
  price_currency text not null default '',
  price_checked_at timestamptz,
  category text not null,
  attributes text not null default '{}',
  availability text not null default 'unknown',
  trend_label text not null default '',
  trend_origin text not null default '',
  trend_at timestamptz,
  sponsored boolean not null default false,
  published boolean not null default false,
  excluded boolean not null default false,
  discovered_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  bot_id text not null,
  unique (source, source_product_id)
);

create index if not exists discover_products_public_idx on discover_products (published, excluded, category, discovered_at desc);
