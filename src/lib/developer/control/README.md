# Developer Center operations

The existing /developer route loads the new control panel. It uses a separate
server session. It does not query or migrate the app database at login or when
opening the dashboard. The prior Developer Center component no longer mounts
legacy cloud, infrastructure, migration, or media tools. Shared server
functions and older settings remain in place for existing callers elsewhere
in the app. No older secrets or records are loaded into the new form.

## Manual Cloudflare setup

Set these Worker secrets before deployment:

- DEVELOPER_ADMIN_EMAIL
- DEVELOPER_ADMIN_PASSWORD (at least 16 characters, use a generated password)
- DEVELOPER_SESSION_SECRET (a separate random value of at least 32 characters)

For the optional Save Configuration and Clear Configuration actions, also
set DEVELOPER_CLOUDFLARE_ACCOUNT_ID, DEVELOPER_CLOUDFLARE_WORKER_NAME, and
DEVELOPER_CLOUDFLARE_API_TOKEN. Use the narrowest Cloudflare permissions for
the intended Worker. The API stages one version with the specified secret
changes. Review the version and deploy it using the existing manual workflow.
The panel never deploys a version itself. Alternatively, set the secrets
directly in Cloudflare without granting the app a Worker management token.

| Field shown in the form | Worker variable or secret |
| --- | --- |
| SUPABASE_URL | SUPABASE_URL |
| SUPABASE_PUBLISHABLE_KEY | SUPABASE_PUBLISHABLE_KEY |
| SUPABASE_SERVICE_ROLE_KEY | WC_DEVELOPER_SUPABASE_SERVICE_ROLE_KEY |
| SUPABASE_DB_URL | WC_DEVELOPER_SUPABASE_DB_URL |

The API check uses the plain Supabase URL and publishable key. A legacy
`SUPABASE_ANON_KEY` can also be used. Hyperdrive is read from the Worker binding.

## Infrastructure diagnostics

The R2 test uses the same effective configuration as uploads, including any
Worker variables that take precedence over saved settings. For a jurisdictional bucket,
set `R2_JURISDICTION` to `eu`, `fedramp` or `us` and configure the matching
jurisdiction on the separate media gateway's R2 binding.

The private gateway and CDN checks verify signed and unsigned access.
RealtimeKit reads the presenter and viewer preset permissions. These checks
do not upload files, create meetings or switch production routing.

## Database preparation

Use the original Supabase project URL and its direct or session pooler Postgres
connection. Start with Inspect Existing Database. Initialize only after you
review that result. Initialization runs the catalog inspection again inside a
transaction and aborts on incompatible shape, partial wedding schema, open
permissions, or foreign key conflicts. Run all verification checks before
using persistent Developer storage. This records a timestamp in the
Developer-only verification table. Individual write checks use a temporary
row and roll back.

- Existing 0017_wedding_core_additive.sql defines circles, circle_members,
  circle_auth, ceremony_invites, couple_access, and wedding_core_recovery.
  It is used only if all five core tables are absent.
- 0028_developer_control.sql creates wc_developer_verification.
- 0029_circle_accounts_additive.sql creates circle_accounts if absent, using
  the existing account ID and email, phone and Firebase identity indexes.

All three files are under migrations/supabase and the normal app migrator does
not apply them. Existing tables are checked instead of recreated. The current
schema uses server-only access: it enables RLS and grants browser roles no
direct access. No new end-user permissions or production routing are enabled.

## Future application data cutover

Reuse circle_accounts.id and its verified Firebase UID for profiles. Keep
circles.slug as the wedding key, and preserve the owner recorded in the wedding
payload. Match that owner to a verified account before materializing a foreign
key. Keep circle_members keyed by (slug, member_key), circle_auth access codes
private, and ceremony_invites keyed by token with expiry and revocation.
The couple_access row contains the two verified bride/groom seats. Preserve
existing timestamps and add audit metadata at the point where each relationship
changes.

Before enabling application data on a new backend, reconcile source accounts
and membership identities, resolve ambiguous owners and roles, and test
server-side authorization for owner, member, invitee and stranger. If end
users ever query Postgres directly, define policies based on verified identity
and the specific wedding relationship. The current deny-by-default RLS
baseline remains in force until that separate work is validated.
