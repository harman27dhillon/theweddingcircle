# Mandatory instructions for every phase

You are modifying the existing The Wedding Circle project. Inspect the current code, routing, theme system, authentication, storage configuration, database schema, permissions, and tests before changing anything. Make the smallest targeted changes. Preserve all existing UI/features/data, wedding access, guest memberships, roles, permissions, settings, persistent backend state, integrations, and working behaviour unless explicitly requested. Never reset/wipe databases or storage, truncate tables, replace files wholesale, remove/disable tests, or create duplicate implementations. Keep secrets, client secrets, tokens, and service-role keys out of client code and logs. Use the existing theme tokens. Run relevant tests/type/build checks where available and report actual results honestly. Finish with files changed, behaviour changed, checks/results, migrations/configuration, and unresolved issues. Implement ONLY this phase; do not begin later phases. Never claim unrun tests passed.

# Phase 2 — Home, Live, header, themes, and landing page

## Wedding Home cleanup
- Remove the entire “Shared so far” section, including its thumbnails/decorative elements.
- Remove the entire “Wedding tools” section and buttons: Change cover, Switch to planning, Pre-wedding, Checklist, Vendors.
- Preserve family details, wedding name/header, bottom navigation, and all other features. UI cleanup only: do not delete photos, wedding data, tools, routes, or functionality elsewhere.

## Continuous wedding countdown
- Add days, hours, minutes, and seconds remaining to the wedding Home page.
- Use the actual persisted wedding date and configured time; never hardcode. Respect wedding local timezone and timezone boundaries.
- Update automatically at least every second while visible without leaking timers or excessive rerenders.
- Changes made by authorised hosts must propagate through existing data sync.
- At zero/past time show “The Wedding Day Is Here!” or equivalent; never negative values.
- Match active theme; keep compact, elegant, responsive. If only date exists, follow existing product semantics rather than inventing a time.

## Live streaming — keep only one stream per wedding
- Keep the existing Live feature and its in-app camera/player, comments, permissions, and working broadcast flow.
- Limit each wedding to **one active live stream at a time**. Do not add or retain a three-stream option, four-stream grid, multi-stream selector, or “Open grid” control.
- Remove the existing three-stream option and any UI/control that lets users choose or open 2, 3, or 4 simultaneous streams. Remove only the multi-stream choice/UI; do not delete unrelated Live functionality or stored wedding data.
- Remove the previously requested update button/control related to enabling or upgrading to four live streams. Do not replace it with another multi-stream or upgrade button.
- Keep the single-stream layout responsive and screen-fitted, preserving video aspect ratio, comments, camera controls, and existing access permissions.
- If another broadcast is already active for the wedding, prevent a second one from starting and show a clear, theme-matched explanation. Do not silently stop or replace the active stream.
- Do not change the underlying streaming provider/backend in this phase unless a small change is strictly required to enforce the one-active-stream rule safely. Inspect existing implementation first and report any backend limitation.

## Wedding header role text — strict boundary
- Remove role words (Host, Co-host, Family, Guest, other role) ONLY from the small subtitle line beneath the wedding name. Keep other non-role text where appropriate.
- Example: “Circle developer · Host · Developer” should lose only the role segment.
- **DO NOT TOUCH THE TOP-RIGHT ROLE BUTTON.** Preserve its appearance, label, functionality, role-specific behaviour, placement, and permissions exactly. Do not change actual role data/access rules.

## Background button theme bug
- The Background button inside More must work under every existing theme, not only Classic Default.
- Fix root theme-dependent cause, not per-theme workarounds. Preserve active theme colours, typography, floral details, persist background using existing storage.
- Keep host/co-host permissions unchanged. Test all themes and light/dark variants.

## Landing page buttons
- Remove the standalone Profile button at the bottom of landing page; move Profile into existing three-dot menu alongside Sign in. Reuse existing Profile screen and authentication/account state.
- Move Platform Desk into existing Developer section and remove its separate current button. Preserve screen/functionality/permissions; no duplicates.

## Theme identities
Preserve the 13 existing themes and their distinct definitions: Royal Burgundy, Pastel Blush, Sage Green, Royal Blue, Classic Ivory, Midnight Emerald, Terracotta Sunset, Lavender Dream, Classic Default, Blossom Pink, Sky Blue, Rose Romance, Peach Garden. Do not confuse Classic Ivory with Classic Default. Do not flatten/rewrite the theme system. New/changed UI uses real active theme tokens and existing light/dark support.

## Acceptance checks
Verify Home sections are removed without deleting data, countdown correctness/zero state, only one live stream can be active per wedding, no multi-stream/three-stream/four-stream or related update button remains, top-right role button is unchanged, Background works in all 13 themes, and Profile/Platform Desk work in their new menu locations.
