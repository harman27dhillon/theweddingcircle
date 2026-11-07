import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { bareCloudflareToken } from "../infra/config.ts";
import { participantCreateBody, readMeetingId, readParticipantToken, REALTIME_API } from "../infra/realtime.ts";
import { TOKEN_TTL_SEC } from "./voice-chat.ts";

export const VOICE_PRESET = "wedding_voice_member";

type RoomResult = { ok: true; id: string } | { ok: false; error: string };

export function realtimeVoiceProvider(sql: Sql, env: Record<string, string | undefined>) {
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const app = env.CLOUDFLARE_REALTIME_APP_ID?.trim() || "";
  const token = bareCloudflareToken(env.CLOUDFLARE_REALTIME_API_TOKEN || "");
  const configured = /^[a-f0-9]{32}$/i.test(account) && /^[a-z0-9-]{1,64}$/i.test(app) && Boolean(token);
  const providerApp = `${account}:${app}`;
  const base = `${REALTIME_API}/accounts/${account}/realtime/kit/${app}/meetings`;

  async function request(path: string, method: "GET" | "POST" | "DELETE", body?: object) {
    const response = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    const data: unknown = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok && Boolean(data && typeof data === "object" && "success" in data && data.success === true), data };
  }

  async function room(slug: string): Promise<RoomResult> {
    const existing = (await sql<{ meeting_id: string }>`
      select meeting_id from voice_realtime_rooms where slug = ${slug} and provider_app = ${providerApp}
    `)[0]?.meeting_id;
    if (existing) return { ok: true, id: existing };

    const lease = randomUUID();
    const [claimed] = await sql<{ lease_id: string }>`
      insert into voice_realtime_rooms (slug, provider_app, lease_id, lease_until)
      values (${slug}, ${providerApp}, ${lease}, now() + interval '30 seconds')
      on conflict (slug, provider_app) do update set lease_id = excluded.lease_id, lease_until = excluded.lease_until
      where voice_realtime_rooms.meeting_id = '' and voice_realtime_rooms.lease_until < now()
      returning lease_id
    `;
    if (!claimed) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const [pending] = await sql<{ meeting_id: string }>`
          select meeting_id from voice_realtime_rooms where slug = ${slug} and provider_app = ${providerApp}
        `;
        if (pending?.meeting_id) return { ok: true, id: pending.meeting_id };
        if (!pending) break;
      }
      return { ok: false, error: "The voice room is opening. Try again in a moment." };
    }

    try {
      const result = await request("", "POST", { title: "Wedding Circle group voice" });
      const id = result.ok ? readMeetingId(result.data) : "";
      if (!id) return { ok: false, error: `RealtimeKit could not open the voice room (HTTP ${result.status}).` };
      const [stored] = await sql<{ meeting_id: string }>`
        update voice_realtime_rooms set meeting_id = ${id} where slug = ${slug}
          and provider_app = ${providerApp} and lease_id = ${lease} returning meeting_id
      `;
      return stored ? { ok: true, id: stored.meeting_id } : { ok: false, error: "The voice room changed while it was opening. Try again." };
    } finally {
      await sql`delete from voice_realtime_rooms where slug = ${slug} and provider_app = ${providerApp} and lease_id = ${lease} and meeting_id = ''`;
    }
  }

  return {
    configured,
    providerApp,
    async join(slug: string, name: string, connectionId: string, now: number) {
      const meeting = await room(slug);
      if (!meeting.ok) return meeting;
      const result = await request(`/${encodeURIComponent(meeting.id)}/participants`, "POST", {
        ...participantCreateBody(name, VOICE_PRESET, connectionId),
        token: { expires_on: new Date(now + TOKEN_TTL_SEC * 1000).toISOString() },
      });
      const authToken = result.ok ? readParticipantToken(result.data) : "";
      const participantId = result.ok ? readMeetingId(result.data) : "";
      if (!authToken || !participantId) {
        if (result.status === 404 && (await request(`/${encodeURIComponent(meeting.id)}`, "GET")).status === 404) {
          await sql`delete from voice_realtime_rooms where slug = ${slug} and provider_app = ${providerApp} and meeting_id = ${meeting.id}`;
        }
        return { ok: false as const, error: `RealtimeKit could not add you to voice chat (HTTP ${result.status}). Check the wedding_voice_member preset and try again.` };
      }
      return { ok: true as const, token: authToken, meetingId: meeting.id, participantId };
    },
    async leave(meetingId: string, participantId: string) {
      await request(`/${encodeURIComponent(meetingId)}/participants/${encodeURIComponent(participantId)}`, "DELETE").catch(() => undefined);
    },
  };
}

export type VoiceProvider = ReturnType<typeof realtimeVoiceProvider>;
