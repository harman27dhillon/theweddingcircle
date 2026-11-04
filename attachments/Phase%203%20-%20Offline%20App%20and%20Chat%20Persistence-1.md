# Phase 3 — Offline App Shell, Wedding Details and Chat Persistence

## Safety and preservation rules
Inspect the current architecture, provider integrations, auth, schema/RLS, storage, Developer section, PWA/service-worker setup, local persistence and tests first. Make minimal incremental changes; reuse existing code. Never rebuild the app, reset/delete/overwrite records, duplicate backends, or migrate data without an explicitly planned and verified migration. Preserve current UI, themes, routes, wedding records, memberships, roles, permissions, media, chat and existing working integrations.

Keep Supabase as the source of truth for existing wedding data, memberships, permissions, chat and current authentication unless a separate explicit migration is approved. Firebase is an optional service provider; it must not silently become a competing source of truth.

Never place Supabase secret/service-role keys, Firebase service-account private keys, private tokens or privileged credentials in browser code, a client bundle, localStorage, IndexedDB, logs, or ordinary client-readable database rows. Client-side Supabase publishable keys and Firebase web config may be used only with correctly configured RLS, Firebase Security Rules, API restrictions and authorised domains. Privileged operations and secrets must stay in trusted server-side secret management. If the current deployment has no secure secret facility, show clear manual environment/secret setup instructions instead of pretending an in-browser form can securely save secrets.

Developer controls must be protected by existing developer/admin authorization, enforced server-side where privileged actions occur; hiding controls in the UI is not security. Never weaken access rules to make a test pass. Don't claim success or test results unless verified. Run relevant tests/type/build checks and report actual results, changed files, required manual setup and unresolved issues.

## 1. App shell and service worker
- Inspect existing framework/hosting and any service worker/PWA config. Reuse or update it; do not register a duplicate worker.
- Cache essential app-shell resources: required HTML/app shell, JS/CSS bundles, fonts, icons and safe offline fallback assets.
- Use versioned caches and safe update/cleanup logic; avoid stale-cache loops and broken launches.
- Do not indiscriminately cache authentication responses, private API responses or secret-bearing data.
- A previously visited/installed user should be able to reopen the app shell offline where the platform supports it.

## 2. IndexedDB cache
- Use IndexedDB for previously loaded wedding details, ceremonies, suitable cover images, relevant preferences, synchronized chat messages, local drafts and a pending-message queue.
- Scope records by authenticated user and wedding ID and use stable IDs.
- Cache only content the user was permitted to access. Record last-synced times so cached data is not presented as live.
- Preserve existing navigation and swipe gestures between Home, Chat, Live, Album and More.
- Cache media only under existing provider rules and sensible storage limits; handle quota errors gracefully.
- Never store passwords, private keys, secret keys or privileged provider credentials locally.

## 3. Wedding and chat persistence
- Open previously synchronized wedding details and chat history offline immediately.
- Preserve message order, sender identity, IDs, timestamps, status, alignment and existing interactions.
- Persist locally composed drafts so closing/reopening the app does not lose them.
- Cache older messages when fetched subject to reasonable retention/storage limits.
- Supabase remains authoritative; local IndexedDB is a cache/queue, not a parallel backend.

## 4. Offline sending and sync
- Allow composing and queueing supported text messages offline, clearly marked **Pending — not sent**.
- Never show queued messages as delivered or read.
- On reconnection, fetch server state and send pending messages with stable client-generated IDs/idempotency checks to avoid duplicates.
- Merge by stable IDs; don't overwrite newer server records with stale local copies.
- Handle interrupted sync, retries, failed sends, expired sessions and account changes safely.
- Re-check permissions server-side before sending queued messages; do not send if access has been revoked.
- Do not claim delivery/read receipts until confirmed by the server.

## 5. Network-dependent features
- Cached wedding Home and navigation may be available offline.
- Live streaming, incoming messages, fresh cloud changes and other network-dependent actions must show a clear offline state with Retry.
- Don't simulate a live stream or falsely claim cloud sync.
- YouTube Live and the app's own camera stream require network connectivity.

## 6. Account privacy
- On logout/account switch, isolate or clear private cached data according to the current account model without deleting server data.
- Never show another user's cached wedding/chat after account switching.
- Do not weaken Supabase RLS or Firebase Security Rules for offline access.
- Re-check authorisation on reconnect; local cache doesn't grant continued server access.

## 7. Acceptance tests
Test online launch; offline launch after prior visit; cached wedding navigation; chat history after closing/reopening; offline drafts/pending messages; reconnect sync; duplicate prevention; expired session; account switching; revoked permissions; quota failure; safe worker updates; and online-only screens. Run relevant checks and report actual results.

## Final report
List files changed, offline behaviours actually implemented, cache strategy, sync/idempotency design, deployment requirements, tests/results and known limitations.
