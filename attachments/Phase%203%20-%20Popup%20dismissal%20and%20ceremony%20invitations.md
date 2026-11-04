# Mandatory instructions for every phase

You are modifying the existing The Wedding Circle project. Inspect the current code, routing, theme system, authentication, storage configuration, database schema, permissions, and tests before changing anything. Make the smallest targeted changes. Preserve all existing UI/features/data, wedding access, guest memberships, roles, permissions, settings, persistent backend state, integrations, and working behaviour unless explicitly requested. Never reset/wipe databases or storage, truncate tables, replace files wholesale, remove/disable tests, or create duplicate implementations. Keep secrets, client secrets, tokens, and service-role keys out of client code and logs. Use the existing theme tokens. Run relevant tests/type/build checks where available and report actual results honestly. Finish with files changed, behaviour changed, checks/results, migrations/configuration, and unresolved issues. Implement ONLY this phase; do not begin later phases. Never claim unrun tests passed.

# Phase 3 — Global popup behaviour and ceremony invitations

## Tap outside to dismiss
- Across pages, small popups, floating option windows, dropdowns, and compact drawers close when tapping outside.
- Taps inside remain functional. Support mouse, touch, and keyboard accessibility.
- Prevent a dismiss tap from triggering a destructive/unrelated control underneath.
- Do not indiscriminately dismiss full-screen media viewers, full-screen dialogs, forms with unsaved work, native share sheets, or flows whose existing pattern requires explicit close. Dismiss only when appropriate.
- Preserve navigation, focus, scrolling, inputs, and theme.

## Invitation button beside access-code entries
- Add an Invitation button beside every existing Family, Guest, Bride, and Groom access-code entry. Do not remove/regenerate/change existing codes.
- Resolve the exact associated wedding/code/type using stable IDs, never list order/display text.
- Feature users: Host, Co-host, Family, Bride, Groom, subject to existing membership/permission model. Do not broaden access.
- Preserve all roles and the top-right role button.

## Interactive ceremony invitation window
- Tapping Invitation opens a compact, theme-matched window showing all configured wedding ceremonies in detail: available name, date, time, venue, description, and other existing fields. Never fabricate missing details.
- User can include/exclude ceremonies for this invitation, removing and adding them back before sharing.
- Selection affects this invitation only, never the actual wedding schedule or ceremony records.
- Clearly indicate selected ceremonies and provide Share action.

## Temporary interactive invitation link
- Create a high-entropy, unpredictable temporary URL associated with the correct wedding, invitation ceremony selection, and proper access-code entry flow.
- It opens an interactive mobile-friendly invitation with selected ceremony details and a safe way to enter the wedding.
- Do not expose unrelated codes, database IDs, secrets, other users' data, or elevated permissions in URL.
- Treat link as a bearer capability: anyone who gets it may use it until expiry. Minimise data/permissions.
- Enforce expiry server-side after exactly 24 hours; URL must be unusable after expiry even if retained in messages/browser history. Client-side hiding alone is insufficient.
- Use backend/database expiry validation. Cleanup of expired invitation records only if safe; never delete wedding/ceremony records. Handle expired link clearly; support safe revocation/regeneration if compatible.
- Recipient access must not exceed the associated code's permissions. Snapshot selected ceremony details or use stable references safely without changing the actual schedule.

## Share to any phone app
- Use native Web Share API where supported to open the phone's share menu. Provide fallback to copy the link or show a usable URL when unavailable.
- Do not claim sharing succeeded until platform reports success.
- Share temporary URL and concise invitation text; avoid plaintext sensitive credentials when existing access flow can avoid them.

## Theme and checks
- Match active theme and light/dark mode for window, selection controls, buttons, link state, expired state.
- Test all code types, exact association, selection changes without schedule mutation, permissions, link expiry enforced by backend, no privilege escalation, native share/fallback, and outside-tap behaviour.
