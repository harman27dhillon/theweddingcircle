# Wedding Chat voice

Chat uses Cloudflare RealtimeKit for group audio. Each wedding gets its own
voice meeting, separate from its ceremony livestream. The Mic and Speaker
controls operate independently and start off when opening Chat.

## Cloudflare setup

Use the same RealtimeKit app and Worker configuration as the livestream.
Set the Worker variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_REALTIME_APP_ID`
and the Worker secret `CLOUDFLARE_REALTIME_API_TOKEN`. The token must allow
creating meetings and adding and removing participants.

Create a preset called `wedding_voice_member` with the Voice (WebRTC) meeting
type. Allow audio. Disable camera, screen sharing, recording and host controls,
including Update Participant Preset. Leave the separate webinar presets for
the livestream.

## Joining and leaving

The Worker applies the wedding's existing membership rules before issuing a
15-minute participant token. It creates the voice meeting on the first join
and reuses it for later participants in the same wedding. It sends Cloudflare
an opaque connection ID. The participant token is the only provider
credential sent to the browser.

The browser joins muted, publishes microphone audio when Mic is turned on,
and plays incoming audio when Speaker is turned on. The mic strip uses a
short-lived heartbeat from joined sessions and displays names from the
wedding membership records. Leaving releases the microphone and asks
RealtimeKit to remove that participant.

To verify deployment, join a test wedding on two devices. Test both directions
of audio, independent Mic and Speaker controls, and leaving Chat. Confirm an
unapproved guest cannot join a wedding that requires approval.
