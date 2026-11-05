# Cloudflare Worker environment inventory

This file is the source-controlled checklist for the existing Cloudflare Worker settings.
It contains names only. Never put credential values in this file, Wrangler `vars`,
Git, build logs, or screenshots.

## Main app Worker: `theweddingcircle`

### Keep as Cloudflare Secrets

These are the existing secret names to retain. Cloudflare Worker secrets are runtime
environment bindings and do not need duplicate declarations in Wrangler `vars`.

- `MEDIA_GATEWAY_SECRET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `CLOUDFLARE_REALTIME_APP_ID`
- `CLOUDFLARE_REALTIME_API_TOKEN`
- `CLOUDFLARE_ZONE_READ_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_STREAM_API_TOKEN` (legacy; retain, not the RealtimeKit token)
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_BUCKET`
- `R2_ACCOUNT_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_DB_URL`

### Additional application settings to check before adding

These names are referenced by the application or its infrastructure modules. Add them
only if the corresponding feature is configured/used in production:

- `FIREBASE_VAPID_KEY`
- `FIREBASE_MEASUREMENT_ID`
- `R2_PUBLIC_DOMAIN` (optional; private media should continue using the signed gateway)
- `LIVESTREAM_PROVIDER`
- `CDN_ENABLED`
- `CDN_MEDIA_DOMAIN`
- `CDN_BASE_URL`
- `MEDIA_GATEWAY_ENABLED`
- `MEDIA_GATEWAY_ORIGIN`
- `MEDIA_EDGE_CACHE`
- `ALLOWED_ORIGINS`
- `APP_ENV`
- `APP_PUBLIC_URL`
- `APP_API_URL`
- `GOOGLE_PLAY_PACKAGE_NAME`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`
- `PLAY_PRODUCT_PREMIUM_THEMES`
- `PLAY_PRODUCT_EXTRA_STORAGE`
- `PLAY_PRODUCT_PREMIUM_MEMBERSHIP`

### Binding

- `HYPERDRIVE` — Hyperdrive binding already declared in `vite.config.ts`, using the
  existing Hyperdrive config ID. Do not create a second binding.

## Explicit exclusions

Do not add any of the following:

- `FIREBASE_STORAGE_BUCKET`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `NEON_AUTH_BASE_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

## Separate Worker: `wedding-circle-media`

This Worker has its own Wrangler file and its own bindings; main-app secrets do not
automatically configure it.

- R2 bucket binding: `MEDIA` (must point to the existing private bucket)
- Secret: `MEDIA_GATEWAY_SECRET` (must match the main app's secret)
- Plain variables: `ALLOWED_ORIGINS`, `MEDIA_EDGE_CACHE`

The actual private bucket name is intentionally not guessed here. The placeholder in
`workers/media-gateway/wrangler.toml` must be replaced with the exact existing bucket
name before deploying that separate Worker.

## Important

- Secret values remain in Cloudflare Secrets; never mirror them into `[vars]`.
- Non-secret values belong in Wrangler `vars` only when their real production values
  are known. Do not deploy blank placeholders over existing working values.
- Supabase has two distinct settings: `SUPABASE_URL` / keys for its API and
  `SUPABASE_DB_URL` for direct PostgreSQL fallback. The app prefers the Hyperdrive
  connection when that binding exists.
- Do not switch traffic, enable a provider, or deploy the media-gateway Worker as part
  of this inventory change.
