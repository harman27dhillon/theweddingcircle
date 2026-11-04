create table if not exists who_said_rounds (
  id text primary key,
  slug text not null,
  starter_key text not null,
  starter_name text not null,
  prompt text not null,
  phase text not null,
  submit_deadline timestamptz not null,
  guess_deadline timestamptz not null,
  score integer not null default 0,
  scored boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists who_said_one_active
  on who_said_rounds (slug)
  where phase in ('submit', 'guess');

create table if not exists who_said_statements (
  id text primary key,
  round_id text not null,
  author_key text not null,
  author_name text not null,
  public_token text not null,
  body text not null,
  sort_index integer not null default 0,
  unique (round_id, author_key)
);

create table if not exists who_said_guesses (
  round_id text not null,
  statement_id text not null,
  guess_key text not null,
  primary key (round_id, statement_id)
);
