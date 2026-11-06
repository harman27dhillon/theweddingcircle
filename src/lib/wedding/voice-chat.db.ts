import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import {
  TOKEN_TTL_SEC,
  SESSION_STALE_MS,
  cleanName,
  visibleMics,
  voiceSlug,
} from "./voice-chat.ts";
import type { VoiceProvider } from "./voice-realtime.ts";

export type VoiceInput = {
  slug: string;
  memberKey: string;
  editKey: string;
  name: string;
  action: string;
  publish: boolean;
  connectionId: string;
};

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const hits = new Map<string, number[]>();

const LIMITS: Record<string, number> = {
  token: 10,
  roster: 40,
  beat: 20,
  leave: 20,
};

function limited(key: string, max: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= max) return true;
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function stamp(ms: number) {
  return new Date(ms).toISOString();
}

async function actor(sql: Sql, input: VoiceInput) {
  const slug = voiceSlug(input.slug);
  const name = cleanName(input.name);
  const key = input.memberKey.trim();
  if (!slug) return { error: "That wedding was not found." as const };
  if (!name) return { error: "Sign in on this phone before joining voice chat." as const };
  if (!KEY.test(key)) return { error: "Join this wedding before joining voice chat." as const };
  const rows = await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`;
  const row = rows[0];
  if (!row) return { error: "This wedding is not on the circle yet." as const };
  if (input.editKey.length >= 16 && row.edit_key === input.editKey) {
    await upsertMember(sql, slug, key, name, "host");
    return { slug, key, name };
  }
  const member = (await sql<{ role: string; name: string }>`select role, name from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (member && ["host", "cohost", "family", "guest"].includes(member.role)) {
    return { slug, key, name: cleanName(member.name) || name };
  }
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as { privacy?: { join?: string } } : row.payload as { privacy?: { join?: string } } | null;
  if (payload?.privacy?.join === "approve") return { error: "Join this wedding with its guest code before using voice chat." as const };
  await upsertMember(sql, slug, key, name, "guest");
  return { slug, key, name };
}

async function upsertMember(sql: Sql, slug: string, key: string, name: string, role: string) {
  await sql`insert into circle_members (slug, member_key, email, name, role)
    values (${slug}, ${key}, ${""}, ${name}, ${role}) on conflict (slug, member_key) do nothing`;
}

export async function voiceOn(sql: Sql, provider: VoiceProvider, input: VoiceInput, now = Date.now()) {
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error, configured: provider.configured };
  const cap = LIMITS[input.action] ?? 10;
  if (limited(`${who.slug}:${who.key}:${input.action}`, cap)) {
    return { ok: false as const, error: "Wait a moment, then try again.", configured: provider.configured };
  }

  const app = provider.providerApp;
  if (input.action === "roster") {
    if (!provider.configured) return { ok: true as const, configured: false, people: [] };
    const cutoff = stamp(now - SESSION_STALE_MS);
    const rows = await sql<{ member_key: string; name: string }>`
      select distinct m.member_key, m.name from voice_realtime_sessions s
      join circle_members m on m.slug = s.slug and m.member_key = s.member_key
      where s.slug = ${who.slug} and s.provider_app = ${app}
        and s.seen_at >= ${cutoff}::timestamptz and s.mic_on
    `;
    return { ok: true as const, configured: true, people: visibleMics(rows.map((row) => ({ memberKey: row.member_key, name: cleanName(row.name) || "Guest" }))) };
  }
  if (!provider.configured) return { ok: false as const, error: "Voice chat isn't available in this wedding yet.", configured: false };

  if (input.action === "token") {
    const cutoff = stamp(now - TOKEN_TTL_SEC * 1000);
    await sql`delete from voice_realtime_sessions where slug = ${who.slug} and seen_at < ${cutoff}::timestamptz`;
    const connectionId = randomUUID();
    const joined = await provider.join(who.slug, who.name, connectionId, now);
    if (!joined.ok) return { ...joined, configured: true };
    try {
      await sql`
        insert into voice_realtime_sessions (connection_id, slug, member_key, provider_app, meeting_id, participant_id, seen_at)
        values (${connectionId}, ${who.slug}, ${who.key}, ${app}, ${joined.meetingId}, ${joined.participantId}, ${stamp(now)}::timestamptz)
      `;
    } catch (error) {
      await provider.leave(joined.meetingId, joined.participantId);
      throw error;
    }
    return { ok: true as const, configured: true, token: joined.token, connectionId, expiresIn: TOKEN_TTL_SEC };
  }

  if (input.action === "leave") {
    const [left] = await sql<{ meeting_id: string; participant_id: string }>`
      delete from voice_realtime_sessions where connection_id = ${input.connectionId}
        and slug = ${who.slug} and member_key = ${who.key} and provider_app = ${app}
      returning meeting_id, participant_id
    `;
    if (left) await provider.leave(left.meeting_id, left.participant_id);
    return { ok: true as const, configured: true };
  }
  if (input.action === "beat") {
    const [active] = await sql<{ connection_id: string }>`
      update voice_realtime_sessions set seen_at = ${stamp(now)}::timestamptz, mic_on = ${input.publish}
      where connection_id = ${input.connectionId} and slug = ${who.slug}
        and member_key = ${who.key} and provider_app = ${app} returning connection_id
    `;
    if (active) return { ok: true as const, configured: true };
    return { ok: false as const, configured: true, error: "Your voice connection ended. Join again." };
  }
  return { ok: false as const, error: "That voice request was not recognised.", configured: true };
}
