# The Wedding Circle — infrastructure setup

This is a preparation guide. None of the external services below are connected in this workspace unless the server environment already has real credentials and a developer has run a successful test. A switch in Developer Center does not create that connection.

## 1. Current architecture

The app is a TanStack Start web app with a service worker. It is not a native Android project.

What already runs, and what this work does not replace:

- Sign-in and wedding membership stay on the current account and member-key flow.
- The app database is chosen by `src/lib/db.ts`: a Supabase URL if `SUPABASE_DB_URL` is set, otherwise the existing database URL if `DATABASE_URL` is set, otherwise an embedded preview database. A failed cloud connection is not silently replaced.
- Wedding media stays on the current library. Cloudflare R2 is an inactive adapter.
- Live is the existing in-app camera until Cloudflare RealtimeKit is tested and armed. RealtimeKit is the only external live provider. It is not R2.
- The one-time circle fee and theme lock stay as they are. Google Play Billing does not unlock anything by itself.
- Developer Center already has its own server session. Infrastructure actions use that same session. A displayed name or a client-side role is not enough.

New modules live under `src/lib/infra/`. The screen is Developer Center → Infrastructure.

## 2. Files added or changed

Added:

- `src/lib/infra/labels.ts` — status names and switch labels safe for the browser.
- `src/lib/infra/core.ts` — configuration assessment, health summary, and switch rules.
- `src/lib/infra/media-policy.ts` — file type, size, membership, and object-key rules.
- `src/lib/infra/r2-sign.ts` — private R2 request signing. The secret is not put in the link.
- `src/lib/infra/google-jwt.ts` — service-account assertion used only on the server.
- `src/lib/infra/live.ts` — who may watch or control an external livestream.
- `src/lib/infra/billing.ts` — Play catalogue slots and purchase decisions.
- `src/lib/infra/infra.server.ts` — developer board, real tests, flags, upload links, purchase verification.
- `src/lib/infra/infra.functions.ts` — server endpoints.
- `src/lib/infra/infra.test.ts` — the checks listed in section 10.
- `src/components/wedding/developer-infrastructure.tsx` — the Infrastructure screen.
- `src/routes/api/infra/health.ts` — public status with no secrets and no “verified” claim.
- `migrations/0020_infrastructure.sql` — flags, check results, and purchase-token hashes.
- `.env.example` — placeholders only.

Changed:

- `src/components/wedding/developer-center.tsx` — adds the Infrastructure section.
- `package.json` — includes the new tests.

Wedding themes, ceremony covers, Home, Chat, Live, Albums, More, and the landing pages were not redesigned.

## 3. Accounts you need before activation

- Firebase / Google Cloud project, with Authentication methods you actually want, and a service account for server checks.
- Cloudflare account, an R2 bucket that stays private, and an API token for R2.
- A Cloudflare RealtimeKit app and an API token with Realtime Admin permission if you want an external livestream. R2 does not process live video.
- Google Play Console, only if you ship an Android wrapper. The web app cannot call the native Play Billing Library.
- The existing database, if you move off the embedded preview database.

Do not buy those plans from inside the app. Nothing in this change creates them.

## 4. Environment variables

Set these on the server. Do not put secrets in frontend code. `.env.example` lists the same names with empty placeholders.

| Variable | Public or secret | Required for | What the app does with it |
|---|---|---|---|
| `APP_ENV` | Public setting | Production mode | `development`, `test`, or `production`. Anything else is treated as development. |
| `APP_PUBLIC_URL` | Public | Later links | Not required for the current app. |
| `APP_API_URL` | Public | Later links | Not required for the current app. |
| `DATABASE_URL` | Secret | Cloud database | Existing app database. Never printed. |
| `SUPABASE_DB_URL` | Secret | Cloud database | If set to a Postgres URL, it is the database. Never printed. |
| `FIREBASE_API_KEY` | Public web config, still not displayed | Firebase | Presence only. |
| `FIREBASE_AUTH_DOMAIN` | Public web config | Firebase | Presence only. |
| `FIREBASE_PROJECT_ID` | Public web config | Firebase | Compared with the service account. The mismatch is an error. |
| `FIREBASE_APP_ID` | Public web config | Firebase | Presence only. |
| `FIREBASE_STORAGE_BUCKET` | Public web config | Optional | Not used as the media store. R2 is the prepared media store. |
| `FIREBASE_MESSAGING_SENDER_ID` | Public web config | Push | Presence only. |
| `FIREBASE_MEASUREMENT_ID` | Public web config | Optional analytics | Not required. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Secret | Firebase server checks and push | Parsed on the server. Invalid JSON is an error. The key is never shown. |
| `FIREBASE_VAPID_KEY` | Secret | Push | Presence only. |
| `R2_ACCOUNT_ID` | Secret-ish | R2 | Used to build the private endpoint. Not shown. |
| `R2_BUCKET` | Not a credential, still not shown in full in errors | R2 | Private bucket name. |
| `R2_ACCESS_KEY_ID` | Secret | R2 | Signing only. |
| `R2_SECRET_ACCESS_KEY` | Secret | R2 | Signing only. A signed link must not contain it. |
| `R2_PUBLIC_DOMAIN` | Public hostname | Optional | Not used for private files. |
| `LIVESTREAM_PROVIDER` | Public setting | External live | Only `cloudflare-realtimekit` is accepted. Empty keeps the in-app camera. |
| `CLOUDFLARE_ACCOUNT_ID` | Account id | RealtimeKit | Same account id used for other Cloudflare APIs. |
| `CLOUDFLARE_REALTIME_APP_ID` | App id | RealtimeKit | From the RealtimeKit dashboard. Not a secret. |
| `CLOUDFLARE_REALTIME_API_TOKEN` | Secret | RealtimeKit | Server only. Needs Realtime Admin or Realtime permission. Not the old Stream token. |
| `CLOUDFLARE_STREAM_API_TOKEN` | Secret, retained | Rollback only | Not shown and not used. It is not deleted automatically. |
| `GOOGLE_PLAY_PACKAGE_NAME` | Public package name | Play | Android application id. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Secret | Play | Server verification only. |
| `PLAY_PRODUCT_PREMIUM_THEMES` | Product id | Play | Leave empty until Play Console has the product. |
| `PLAY_PRODUCT_EXTRA_STORAGE` | Product id | Play | Same. |
| `PLAY_PRODUCT_PREMIUM_MEMBERSHIP` | Product id | Play | Same. Subscription slot. |
| `INFRA_DISABLE_FIREBASE` | Setting | Kill switch | `1` forces Disabled. |
| `INFRA_DISABLE_DATABASE` | Setting | Kill switch | `1` forces Disabled. |
| `INFRA_DISABLE_R2` | Setting | Kill switch | `1` forces Disabled. |
| `INFRA_DISABLE_LIVESTREAM` | Setting | Kill switch | `1` forces Disabled. |
| `INFRA_DISABLE_PLAY` | Setting | Kill switch | `1` forces Disabled. |
| `INFRA_DISABLE_PUSH` | Setting | Kill switch | `1` forces Disabled. |

Validation is presence, shape, and a live test. Missing optional providers do not stop the app. The relevant feature stays off and Developer Center explains why.

## 5. How to test locally

1. Open Developer Center and unlock it with the existing developer session.
2. Open Infrastructure.
3. Expect Not configured on Firebase, R2, the external livestream, Play Billing, and push when those variables are absent.
4. Expect the app database to say it is the embedded preview database when no cloud URL is set. Test connection runs `select 1` and does not print a URL.
5. Pressing Test connection on a missing provider must not say Connected and verified.
6. Arming R2, Firebase, Play, livestream, or push before a successful test must be refused.
7. Production mode must stay off unless `APP_ENV` is `production` and the confirmation phrase is entered.
8. Media migration asks for `START MEDIA MIGRATION` and still does not copy files.
9. `GET /api/infra/health` returns coarse states only. It must not include credentials.

## 6. Firebase and Google Cloud

1. Create the Firebase project and a web app.
2. Enable the authentication methods you intend to use, including email verification and password reset, in the Firebase console. This app does not switch its current sign-in when you do that.
3. Create a service account. Put the JSON only in `FIREBASE_SERVICE_ACCOUNT_JSON`.
4. Set the web fields listed above. Do not paste the private key into `FIREBASE_API_KEY`.
5. In Infrastructure, run Test connection on Firebase. The test asks Google for an access token and then discards it. Success means the service account was accepted. It does not mean wedding sign-in has moved.
6. Security rules are not a substitute for the server membership checks already used for weddings.
7. Keep the current database until you deliberately migrate. The existing Database and AutoSync tools remain the place for that move. This panel does not copy rows.

Push, if you want it later: set the VAPID key, sender id, app id, and the same service account. Test connection on Push. The app still does not ask people for notification permission.

**Send verification code** uses the server-side `RESEND_API_KEY` Cloud variable. Resend must show `mail.theweddingcircle.in` as verified for sending. The sender is `no-reply@mail.theweddingcircle.in`.

Users request a code after creating an account or signing in with an unverified email. The email contains a six-digit code that expires after 10 minutes or five failed attempts. The Firebase service account needs the `firebaseauth.users.sendEmail` IAM permission to generate the underlying Firebase verification action. Keep `FIREBASE_AUTH_DOMAIN` set to the project's existing Firebase Auth host.

## 7. Cloudflare R2

1. Create a private bucket. Do not turn on public listing.
2. Create an R2 access key. Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.
3. Run Test connection. The server sends a private HEAD request. It does not upload a wedding file.
4. After the test is verified, you may arm R2 media storage. Existing album, chat, profile, and cover uploads stay on the current library.
5. A future upload uses a short-lived signed link only after a wedding member key matches `circle_members`, the file type and size are allowed, and the object key starts with that wedding. Guessing another wedding’s key does not grant access.
6. Limits: images 12 MB, video 80 MB, audio 8 MB. JPEG, PNG, WebP, GIF, MP4, WebM, and common audio types only.
7. Media migration can be armed only after R2 is verified and you type `START MEDIA MIGRATION`. No files are copied. Cutover is still a separate, deliberate step. Do not delete the current library.

## 8. Livestream provider

1. Leave `LIVESTREAM_PROVIDER` unset to keep today’s in-app camera.
2. To prepare Cloudflare RealtimeKit, set `LIVESTREAM_PROVIDER` to `cloudflare-realtimekit`, plus `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_REALTIME_APP_ID`, and `CLOUDFLARE_REALTIME_API_TOKEN`. The token needs Realtime Admin or Realtime permission. Do not reuse a Stream token.
3. Test connection reads presets, then reads `webinar_presenter` and `webinar_viewer`. It does not create an app, a meeting, or a participant.
4. The test is not operational unless the presenter can publish audio, video, and screen share, and the viewer cannot publish (`NOT_ALLOWED` or `CAN_REQUEST`).
5. Arm the livestream switch only after that test. A host start then creates one meeting for that ceremony. Guests receive a watch-only token. The in-app camera stays in use when the provider is not armed.
6. Register the webhook yourself in Cloudflare. Do not expect this app to register it. `POST https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/realtime/kit/$APP_ID/webhooks` with `meeting.started`, `meeting.ended`, `meeting.participantJoined`, `meeting.participantLeft`, and `recording.statusUpdate`, pointing at `https://<your-host>/api/realtime/webhook`.
7. A finished recording is copied into the private bucket. A replay line is added to wedding chat only after that copy succeeds. The temporary RealtimeKit download link is not stored in the chat.
8. An old `CLOUDFLARE_STREAM_API_TOKEN` can stay in the vault for rollback. It is not used for tests or meetings.

## 9. Google Play Billing

1. This repository is a web app. Do not add the native Android Billing Library to the React screens. A Trusted Web Activity or another wrapper, and the Digital Goods API or a native shell, has to exist before a phone can start a purchase.
2. In Play Console, create the real products. Then set the three `PLAY_PRODUCT_*` variables to those ids. This project does not invent ids or prices.
3. Put a Play service account with Android Publisher access in `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, and set `GOOGLE_PLAY_PACKAGE_NAME`.
4. Test connection only checks that Google accepts the service account. It does not buy anything.
5. Arm Play Billing only after that test. Purchase verification calls Google. The browser saying “purchased” is not enough.
6. The same purchase token is stored as a hash. A repeat does not grant twice. A cancelled or refunded purchase does not grant access. The current theme and storage screens are not changed by that record yet. Entitlement still has to be applied in a later, explicit step if you want Play to replace the existing circle fee.

## 10. Security checks

Covered by `src/lib/infra/infra.test.ts`:

- Missing, partial, and invalid configuration.
- Secrets are absent from the public health summary and from status text.
- A verified result is dropped if the set of configured variables changes.
- Switches refuse an untested provider, a missing confirmation, production mode outside production, and cloud-database arming on the embedded database.
- Strangers, disallowed file types, oversized files, and another wedding’s object key are rejected.
- Livestream watch is members-only. Guests cannot start it. A missing provider does not invent a stream.
- Purchases fail closed, duplicates do not grant twice, and a refund does not grant access.
- A missing developer session does not receive the status board.

Also enforced on the server: developer routes call the existing developer session check; upload and download links require a membership row; signed links expire (10 minutes to upload, 5 minutes to download); errors are redacted; audit notes record the action, not secrets or purchase tokens.

## 11. What is still manual

- No Firebase project, R2 bucket, RealtimeKit account, or Play Console product is connected by saving this documentation. A Test connection is a real read and is not claimed here.
- The current sign-in, database, media library, in-app camera, and circle fee are still the live path.
- Arming a switch records permission to use the new adapter. It does not cut over.
- Media migration does not copy or delete files.
- Play entitlements are recorded only after Google confirms a purchase. A preview payment does not set `payment.verified`, so it does not unlock premium themes or the 10 GB allowance. Free weddings are limited to 500 MB. Existing files over that allowance stay available; further uploads that would pass the allowance are refused. Real ₹499 purchases still need a Play Console product and a server verification step before Premium can turn on.
- Push permission is not requested.
- Production mode does not publish the app.
- Email verification, password reset, and Firestore rules still have to be configured in Google’s consoles if you choose Firebase.
- An Android wrapper does not exist in this repository.

Do not describe these services as ready for production until each test has succeeded with real credentials and you have chosen a cutover on purpose.

## 12. Private media gateway

The R2 bucket stays private. `media.theweddingcircle.in` must be a Worker route, not an R2 public custom domain and not an `r2.dev` URL.

What was added, and not deployed:

- `workers/media-gateway/` — Worker that checks an HMAC-SHA256 token, then reads the existing bucket through a private binding named `MEDIA`.
- Server signing in `src/lib/infra/media-token.ts`. A token names one object key, the wedding, `GET` and `HEAD`, inline or download, and an expiry 15 minutes out.
- Developer Center → Infrastructure → Private media gateway. Saving it does not change DNS. Delivery stays on the current private path until the gateway test is verified for that host and secret.

Token lifetime is 15 minutes. A guest who is removed cannot mint a new token. A token already issued still works until it expires. That is the remaining window.

The Worker responds `Cache-Control: private, no-store`. Do not add a Cache Everything rule. Shared caching is intentionally off, so this gateway does not make uploads faster and does not speed playback by caching private files at the edge.

Manual Cloudflare steps, only after you approve them:

1. Keep the existing bucket private. Do not enable public access or `r2.dev`.
2. Create a Worker from `workers/media-gateway` with binding `MEDIA` → the existing `R2_BUCKET`.
3. Set Worker secret `MEDIA_GATEWAY_SECRET` (32+ characters). Set the same value on the app server. Do not put it in the browser.
4. Set Worker variable `ALLOWED_ORIGINS` to `https://theweddingcircle.in,https://www.theweddingcircle.in` plus any other real app origin. No wildcard.
5. Add only the DNS record that routes `media.theweddingcircle.in` to the Worker. Do not change the website records.
6. In Developer Center, set the origin to `https://media.theweddingcircle.in`, save, and run Test gateway.
7. Until that test is verified, albums keep using the existing signed or app path.

Rollback: turn the gateway off and save. New views return to the previous path. Unbind the hostname from the Worker if you added it. Do not delete objects.

