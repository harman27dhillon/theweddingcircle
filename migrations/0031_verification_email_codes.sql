create table if not exists wc_verification_email_codes (
  account_key text primary key,
  digest text not null,
  cipher text not null,
  nonce text not null,
  expires_at timestamptz not null,
  attempts_left integer not null check (attempts_left between 0 and 5)
);
alter table wc_verification_email_codes enable row level security;
