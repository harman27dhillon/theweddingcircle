import { SignJWT } from "jose";
import { TOKEN_TTL_SEC, adminGrant, memberGrant, type VoiceGrant } from "./voice-chat.ts";

export type LiveKitConfig =
  | { configured: false; reason: "missing" | "url" | "insecure" | "secret" }
  | { configured: true; url: string; key: string; secret: string };

type Env = Record<string, string | undefined>;

export function liveKitConfig(env: Env): LiveKitConfig {
  const url = (env.LIVEKIT_URL || "").trim();
  const key = (env.LIVEKIT_API_KEY || "").trim();
  const secret = (env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !key || !secret) return { configured: false, reason: "missing" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { configured: false, reason: "url" };
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const secure = parsed.protocol === "wss:";
  if (parsed.protocol !== "wss:" && !(parsed.protocol === "ws:" && local)) return { configured: false, reason: "insecure" };
  if ((env.APP_ENV || "").trim() === "production" && !secure) return { configured: false, reason: "insecure" };
  if (key.length < 3 || secret.length < 16 || /\s/.test(key) || /\s/.test(secret) || key === secret) {
    return { configured: false, reason: "secret" };
  }
  return { configured: true, url: url.replace(/\/$/, ""), key, secret };
}

export function liveKitHttpOrigin(url: string) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.origin;
}

export async function signVoiceJwt(key: string, secret: string, identity: string, name: string, grant: VoiceGrant, ttlSec = TOKEN_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ name, video: grant })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(key)
    .setSubject(identity)
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + ttlSec)
    .sign(new TextEncoder().encode(secret));
}

function record(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function micLive(track: Record<string, unknown> | null) {
  if (!track || track.muted === true) return false;
  const source = track.source;
  if (source === "SCREEN_SHARE_AUDIO" || source === "SCREEN_SHARE" || source === 4 || source === 3) return false;
  if (source === "screen_share_audio" || source === "screen_share") return false;
  const type = track.type;
  const audio = type === "AUDIO" || type === "audio" || type === 0;
  const mic = source === undefined || source === "MICROPHONE" || source === "microphone" || source === 2 || source === "UNKNOWN" || source === 0;
  return audio && mic;
}

/** Identities that currently have an unmuted microphone track. Duplicates collapse. */
export function speakersFromParticipants(body: unknown) {
  const root = record(body);
  const list = Array.isArray(root?.participants) ? root.participants : [];
  const ids: string[] = [];
  for (const item of list) {
    const person = record(item);
    const identity = typeof person?.identity === "string" ? person.identity : "";
    const tracks = Array.isArray(person?.tracks) ? person.tracks : [];
    if (identity && tracks.some((track) => micLive(record(track)))) ids.push(identity);
  }
  return [...new Set(ids)].sort();
}

async function adminToken(cfg: Extract<LiveKitConfig, { configured: true }>, room: string) {
  return signVoiceJwt(cfg.key, cfg.secret, "voice-server", "voice-server", adminGrant(room), 60);
}

async function twirp(cfg: Extract<LiveKitConfig, { configured: true }>, method: string, room: string, body: Record<string, unknown>) {
  const token = await adminToken(cfg, room);
  const response = await fetch(`${liveKitHttpOrigin(cfg.url)}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return response;
}

export function liveKitProvider(env: Env = process.env) {
  const cfg = liveKitConfig(env);
  return {
    configured: cfg.configured,
    url: cfg.configured ? cfg.url : "",
    async signMember(identity: string, name: string, room: string) {
      if (!cfg.configured) throw new Error("LiveKit is not configured.");
      return signVoiceJwt(cfg.key, cfg.secret, identity, name, memberGrant(room));
    },
    async allowPublish(room: string, identity: string, publish: boolean) {
      if (!cfg.configured) return { ok: false as const, error: "Voice chat isn't available in this wedding yet." };
      try {
        const response = await twirp(cfg, "UpdateParticipant", room, {
          room,
          identity,
          permission: { canSubscribe: true, canPublish: publish, canPublishData: false },
        });
        if (response.ok) return { ok: true as const };
        if (response.status === 404) return { ok: false as const, error: "The voice room is still connecting. Try the microphone again." };
        if (response.status === 401 || response.status === 403) return { ok: false as const, error: "Voice chat refused the server credentials." };
        return { ok: false as const, error: "The microphone could not be opened for this wedding." };
      } catch {
        return { ok: false as const, error: "Voice chat could not reach the room." };
      }
    },
    async speakers(room: string) {
      if (!cfg.configured) return { ok: false as const, error: "unconfigured" };
      try {
        const response = await twirp(cfg, "ListParticipants", room, { room });
        if (response.status === 404) return { ok: true as const, identities: [] as string[] };
        if (!response.ok) return { ok: false as const, error: "roster" };
        const body: unknown = await response.json();
        return { ok: true as const, identities: speakersFromParticipants(body) };
      } catch {
        return { ok: false as const, error: "roster" };
      }
    },
  };
}

export type VoiceProvider = ReturnType<typeof liveKitProvider>;
