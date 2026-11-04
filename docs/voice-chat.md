# Wedding Chat voice

Live voice in Chat uses a LiveKit SFU. The app does not run the media server. Messages, themes, and the developer music library are unchanged. The old Chat music-note button is now the microphone.

## What you need to set

These are server environment variables. Do not put them in frontend code and do not prefix them with `VITE_`.

| Variable | Example | Notes |
|---|---|---|
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` | WebSocket URL. Production must be `wss://`. `ws://127.0.0.1` is only for a local server. |
| `LIVEKIT_API_KEY` | from LiveKit | API key. Not a secret to print. |
| `LIVEKIT_API_SECRET` | from LiveKit | Used only to sign room tokens. At least 16 characters. |

Until all three are set, Chat still works. Mic and Speaker stay off, and turning one on explains that voice is not available. No fake audio is played.

## LiveKit setup

1. Create a project at [LiveKit Cloud](https://cloud.livekit.com) or run the open-source LiveKit server on a machine that can accept WebRTC (UDP or TCP 7881, plus the signal port).
2. Copy the WebSocket URL, API key, and API secret into the server environment.
3. Redeploy. Ordinary wedding members receive a 15-minute room token. The token can subscribe, and it cannot publish, administer, or record.
4. Publishing is turned on only after that person taps Mic, and only for their own identity. The server asks LiveKit to allow the microphone, then the browser publishes.

LiveKit Cloud's Build plan includes a free monthly allowance and then charges for extra connection time. A self-hosted server has no LiveKit license fee; you pay for the machine and bandwidth. This app does not record or store audio.

## What the server checks

- The person has this wedding's edit key, or is already a member, or the wedding is open to guests.
- The room name is `wc-voice-` plus that wedding's slug. A client cannot pick another wedding's room.
- Roster names come from membership records. A microphone shows only when LiveKit reports an unmuted microphone track for that member.
- Speaker on/off is local. It never changes anyone else's microphone.
- Refresh, logout, leaving Chat, and hiding the phone start with the microphone off. A previous ON state is not restored.

## Routes

Server functions, not public unauthenticated URLs:

- `issueVoiceToken`
- `allowVoicePublish`
- `readVoiceRoster`
- `beatVoiceSession`
- `leaveVoiceRoom`

There is no recording endpoint.
