# Phase 1 — Developer Cloud Connections Dashboard

## Safety and preservation rules
Inspect the current architecture, provider integrations, auth, schema/RLS, storage, Developer section, PWA/service-worker setup, local persistence and tests first. Make minimal incremental changes; reuse existing code. Never rebuild the app, reset/delete/overwrite records, duplicate backends, or migrate data without an explicitly planned and verified migration. Preserve current UI, themes, routes, wedding records, memberships, roles, permissions, media, chat and existing working integrations.

Keep Supabase as the source of truth for existing wedding data, memberships, permissions, chat and current authentication unless a separate explicit migration is approved. Firebase is an optional service provider; it must not silently become a competing source of truth.

Never place Supabase secret/service-role keys, Firebase service-account private keys, private tokens or privileged credentials in browser code, a client bundle, localStorage, IndexedDB, logs, or ordinary client-readable database rows. Client-side Supabase publishable keys and Firebase web config may be used only with correctly configured RLS, Firebase Security Rules, API restrictions and authorised domains. Privileged operations and secrets must stay in trusted server-side secret management. If the current deployment has no secure secret facility, show clear manual environment/secret setup instructions instead of pretending an in-browser form can securely save secrets.

Developer controls must be protected by existing developer/admin authorization, enforced server-side where privileged actions occur; hiding controls in the UI is not security. Never weaken access rules to make a test pass. Don't claim success or test results unless verified. Run relevant tests/type/build checks and report actual results, changed files, required manual setup and unresolved issues.

## Goal
Add a protected **Developer → Cloud Connections** area to the existing app. This phase creates the dashboard and safe configuration workflow. It must not change active production providers by default.

## Provider panels
**Supabase panel**
- Fields for project URL and publishable key for client use.
- Status: Not configured / Needs setup / Connected / Error.
- A read-only **Test connection** action with a real result and actionable errors.
- Explain that secret/service-role keys are server-only and must never be entered into a browser configuration form.

**Firebase panel**
- Fields for the Firebase web app config required for selected services: apiKey, authDomain, projectId, storageBucket only when Storage is selected, messagingSenderId, appId, and optional measurementId only when Analytics is enabled.
- Explain that web config is public project configuration, not an authorization system; Security Rules, App Check where appropriate, API restrictions and authorised domains still matter.
- Show a test result for each selected capability. FCM requires additional messaging/HTTPS/service-worker/browser permission and VAPID/web-push configuration where applicable; don't mark it connected just because the config values are present.

## Per-service assignments
Show explicit provider assignment for:
- Wedding records, memberships, chat and current authentication: keep existing Supabase setup as source of truth by default.
- Media storage: keep the existing provider by default; allow selecting Supabase Storage or Firebase Cloud Storage only after configuration is tested and the developer confirms.
- Push notifications: preserve the current provider by default; allow Firebase Cloud Messaging only after its setup and device/browser requirements are met.
- Analytics: off by default; enable only when explicitly configured.

Do not offer a one-click switch from Supabase database/auth/chat to Firebase Firestore/Auth. Core-data migration is a separate project requiring an explicit, verified plan.

## Configuration and controls
- Inspect how public client configuration is currently supplied (environment variables/build-time config or existing runtime configuration).
- Save only client-safe config through the existing authorised mechanism. For privileged secrets, direct the developer to a trusted backend secret store/environment variables with exact variable names. Never store secrets in browser storage or a normal client-readable table.
- Distinguish **configured**, **connection tested**, and **active for service** as separate states.
- Provide Test, Save/Apply and Cancel actions; include Disconnect only where it is safe. Do not apply a new provider until test succeeds and the developer explicitly confirms.
- Changing a storage destination must warn that existing files remain in their original storage until a separately verified migration exists. Do not break existing URLs or silently copy/delete files.
- Mask credentials where practical, avoid logging values, require confirmation before replacing connection settings, and show last successful test time.
- Developer UI must be responsive, theme-aware, and hidden/blocked for unauthorised users without changing roles.

## Acceptance checks
1. Cloud Connections appears only to authorised Developer/admin users.
2. Supabase and Firebase configuration/status are separate and truthful.
3. Read-only tests work or show actionable failures.
4. Current provider assignments remain unchanged by default.
5. No privileged key reaches client code, browser storage, logs or a client-readable row.
6. No service switches automatically; no data is migrated or deleted.
7. Existing app features continue working.
8. Run relevant checks and report actual results.

## Final report
List files changed, how access is protected, which config is stored where, tests run, required dashboard/environment steps, and unresolved issues.
