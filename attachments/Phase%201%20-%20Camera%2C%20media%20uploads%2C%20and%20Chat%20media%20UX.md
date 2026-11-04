# Mandatory instructions for every phase

You are modifying the existing The Wedding Circle project. Inspect the current code, routing, theme system, authentication, storage configuration, database schema, permissions, and tests before changing anything. Make the smallest targeted changes. Preserve all existing UI/features/data, wedding access, guest memberships, roles, permissions, settings, persistent backend state, integrations, and working behaviour unless explicitly requested. Never reset/wipe databases or storage, truncate tables, replace files wholesale, remove/disable tests, or create duplicate implementations. Keep secrets, client secrets, tokens, and service-role keys out of client code and logs. Use the existing theme tokens. Run relevant tests/type/build checks where available and report actual results honestly. Finish with files changed, behaviour changed, checks/results, migrations/configuration, and unresolved issues. Implement ONLY this phase; do not begin later phases. Never claim unrun tests passed.

# Phase 1 — Shared camera/upload system and Chat media UX

## Shared system across the whole app
Use one shared camera and media-upload pipeline for every existing camera/upload button across Chat, Feed, Album, Live-related capture/upload controls, wedding creation/editing, cover/profile/background fields, Host Control, and other media entry points. Preserve each section's behaviour and permissions. Do not fix only one button and leave others on an old path.

## Camera quality and recording
- Preserve the highest practical photo quality and best stable video resolution, FPS, and bitrate supported by the device/browser/camera API.
- Avoid unnecessary capture-resolution reduction, processing, dropped frames, lag, overheating, and battery use.
- Respect portrait orientation and aspect ratio; never stretch media or crop unless requested.
- Preserve tap-to-take-photo and long-press-to-record behaviour where currently supported.
- Detect capabilities and gracefully fall back to best stable settings; do not promise unsupported performance.
- Keep capture quality separate from upload optimisation: capture at best stable quality, then optimise an upload copy where appropriate.

## Sources and formats
- Accept media from all sources the platform/browser legitimately supports: in-app camera, Android/system picker, gallery, Google Photos where supported, file/document picker, screenshots, downloads, and supported providers.
- Correctly handle content URIs, temporary URIs, file handles, and access/permission lifetimes.
- Detect actual media type from content/metadata where feasible, not extension alone.
- Support practical image/video formats; convert valid unsupported files when technically possible while preserving orientation, aspect ratio, transparency where applicable, video duration, audio, and reasonable quality.
- Do not claim universal compatibility; provide clear errors for corrupt/unsupported files.
- Google Photos is not a general-purpose upload bucket. Respect actual API capabilities/scopes. Do not silently switch configured storage providers or break working in-app camera uploads. Diagnose a failing source path specifically.

## Quality-first compression
- Automatically compress/optimise large photos/videos during upload, stopping before additional compression causes noticeable quality loss.
- Photos: sensible resizing/encoding while preserving details, sharpness, colours, orientation, and transparency when supported.
- Videos: intelligently reduce size while maintaining resolution and smooth FPS where practical; preserve audio, duration, orientation, and aspect ratio.
- Avoid needless compression of small/already-efficient files and avoid needless full-resolution re-encoding.
- Prefer an optimised upload copy rather than degrading the captured original.

## Upload speed and reliability
- Start promptly; avoid redundant reads, needless preprocessing, duplicate requests, and unnecessary server-side relays.
- Use secure direct-to-configured-storage uploads when supported.
- Upload multiple files concurrently with a sensible limit; avoid exhausting mobile memory, CPU, network, or battery.
- Use resumable/chunked uploads for large files when supported by the configured provider.
- Show genuine per-file progress; never fake progress. Keep UI responsive.
- Retry transient failures safely without duplicate media records/messages. Preserve selected files on failure and explain errors.
- Clean up temporary processing resources when appropriate. Keep authentication, privacy, authorisation, and storage rules intact.

## Chat media layout
- One photo/video uses a compact larger preview (roughly 220–260 px max width and 240–280 px max height on a typical phone, adjusted to the current layout).
- Multiple selected files appear as ONE compact collage/grid inside one grouped Chat message, not oversized individual cards; preserve selection order.
- Two files: side-by-side compact thumbnails. Three/four: balanced grid. Five or more: compact collage with +N overlay if useful. More files means smaller tiles. Collage must not dominate the conversation.
- Every tile is individually tappable and opens that specific item. Videos show a play indicator.
- Progress/success/failure/retry state is independent per item. No fake shared progress, duplicate messages, or duplicate uploads.
- Preserve alignment (other users left, current user right, based on stable IDs), history/scrolling, and return to prior scroll position when closing viewer.

## Theme-aware media frame and bottom line
- Remove the prominent white border around photo/video previews. Replace it with a thin, subtle, low-contrast frame from the active wedding theme, with no heavy border or excess padding. Apply to single media and collage tiles across themes.
- Remove the unwanted white horizontal line just above bottom navigation. Identify and fix the actual border/divider/background/safe-area source; do not hide unrelated content. Verify across themes/screens.

## Chat filter drawer
- Add a compact clickable header/drawer directly beneath the existing top information bar.
- It opens filters for Photos, Videos, Voice Notes. Selecting a filter temporarily hides unrelated messages from view; never delete or alter chat history.
- Include Reset/All to restore the full timeline in correct order.
- Use actual message/media data to distinguish types. Theme the drawer, borders, icons, selected states, and reset control through the existing theme system, including light/dark modes.
- Preserve alignment, scroll, composer, upload progress, and navigation.

## Composer/keyboard position
- When keyboard opens, keep the option bar (calendar, people, information icons) in its original position relative to the Chat layout. It must not jump into the gap between keyboard and message text bar.
- Keep composer directly above keyboard. Prevent duplicate bars and viewport/keyboard resize bugs. Preserve controls, theme, spacing, navigation.

## Acceptance checks
Test every upload entry point where possible; camera photo/video, gallery/system picker, multiple and large files, unsupported/corrupt files, interrupted uploads/retries. Verify sensible compression, genuine progress, no duplicates, collage viewer, filters/reset, themed frames, removal of white line, and composer/keyboard layout.
