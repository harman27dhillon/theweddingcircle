# Phase 2 — Connect Supabase and Firebase to the Existing App

## Safety and preservation rules
Inspect the current architecture, provider integrations, auth, schema/RLS, storage, Developer section, PWA/service-worker setup, local persistence and tests first. Make minimal incremental changes; reuse existing code. Never rebuild the app, reset/delete/overwrite records, duplicate backends, or migrate data without an explicitly planned and verified migration. Preserve current UI, themes, routes, wedding records, memberships, roles, permissions, media, chat and existing working integrations.

Keep Supabase as the source of truth for existing wedding data, memberships, permissions, chat and current authentication unless a separate explicit migration is approved. Firebase is an optional service provider; it must not silently become a competing source of truth.

Never place Supabase secret/service-role keys, Firebase service-account private keys, private tokens or privileged credentials in browser code, a client bundle, localStorage, IndexedDB, logs, or ordinary client-readable database rows. Client-side Supabase publishable keys and Firebase web config may be used only with correctly configured RLS, Firebase Security Rules, API restrictions and authorised domains. Privileged operations and secrets must stay in trusted server-side secret management. If the current deployment has no secure secret facility, show clear manual environment/secret setup instructions instead of pretending an in-browser form can securely save secrets.

Developer controls must be protected by existing developer/admin authorization, enforced server-side where privileged actions occur; hiding controls in the UI is not security. Never weaken access rules to make a test pass. Don't claim success or test results unless verified. Run relevant tests/type/build checks and report actual results, changed files, required manual setup and unresolved issues.

## Goal
Wire the Cloud Connections settings from Phase 1 into real provider clients and supported services. Existing connections must remain active until a developer explicitly tests and applies a supported change.

## Supabase
- Reuse the existing Supabase client/project.
- Keep wedding records, couple/family details, ceremonies, memberships, roles, permissions, chat and current authentication on Supabase as the authoritative source.
- Use a publishable key in client-side code with RLS on all exposed tables and correct least-privilege policies.
- Any operation requiring a secret key must be performed by a trusted backend/Edge Function with server-side authorization.
- Use a minimal read-only connection test.

## Firebase
Implement only the selected services:
- **Cloud Storage:** optional destination for new media uploads.
- **Cloud Messaging:** optional push notifications after all supported setup is complete.
- **Analytics:** optional and off by default, with appropriate privacy/consent handling if enabled.
Do not enable Firebase Auth or Firestore by default and do not migrate Supabase users, wedding records or chat.

Use official Firebase SDKs compatible with the existing framework. Initialise each app/service once and handle missing config without breaking the app.

## Media routing and migration safety
- Keep the current media provider active by default.
- If Firebase Storage is selected for new uploads, validate config/rules and perform an authorised test upload/download using a disposable test object or existing safe test mechanism. Require developer confirmation before activating it.
- Do not move, delete, copy or re-key existing media automatically. Keep old files accessible at their original provider.
- Store provider/object-path metadata with media references when needed so each file resolves to its actual storage provider.
- Route new uploads to exactly one selected destination; never silently duplicate uploads across providers.
- Enforce wedding membership/ownership, allowed MIME types, size limits and quotas through trusted backend checks and storage rules.
- If safe switching isn't possible, leave the current provider active and clearly explain what's missing.

## Push notifications
- Keep existing notifications unless FCM is explicitly configured and tested.
- Request notification permission only at an appropriate user-initiated moment.
- Store device tokens on the backend with ownership controls; never expose another user's token.
- Put sender credentials in a trusted backend/secret store.
- If native Android/iOS or web push requires additional platform setup, show exactly what's still needed rather than falsely reporting it as ready.

## Connect/Test/Apply behaviour
- Wire Phase 1 controls to actual provider clients.
- Tests should be read-only where possible and must not mutate production data.
- Apply changes only after successful checks and explicit confirmation.
- Keep prior settings until the new configuration is confirmed working.
- Disconnecting a provider must not delete its stored files or server data.
- Handle revoked credentials, quota limits, outages and missing config with useful errors, and don't log secrets.

## Acceptance checks
Verify Supabase data/auth/chat/RLS unchanged; Firebase services initialise only when selected; one active new-media destination; old media still opens; FCM setup status is truthful; no privileged keys exposed; tests and Apply work safely; all current features remain intact. Run relevant tests/type/build checks.

## Final report
List changed files, connected services, verified Supabase functionality, secret/config locations, manual steps, tests and unresolved items.
