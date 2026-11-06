create table if not exists wc_verification_email_limits (
  bucket text primary key,
  expires_at timestamptz not null,
  attempts integer not null
);
alter table wc_verification_email_limits enable row level security;
