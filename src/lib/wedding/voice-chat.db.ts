import {
  ROSTER_CACHE_MS,
  SESSION_STALE_MS,
  cleanName,
  roomName,
  visibleMics,
  voiceSlug,
  type RosterPerson,
} from "./voice-chat.ts";
import type { VoiceProvider } from "./voice-livekit.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type VoiceInput = {
  slug: string;
  memberKey: string;
  editKey: string;
  name: string;
  action: string;
  publish: boolean;
};

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const hits = new Map<string, number[]>();
const speakerCache = new Map<string, { at: number; identities: string[] }>();

const LIMITS: Record<string, number> = {
  token: 10,
  publish: 20,
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

export async function ensureVoice(sql: Sql) {
  await sql.query(`create table if not exists voice_sessions (
    slug text not null,
    member_key text not null,
    name text not null default '',
    connected boolean not null default false,
    joined_at timestamptz not null default now(),
    seen_at timestamptz not null default now(),
    primary key (slug, member_key)
  )`);
  await sql.query(`create index if not exists voice_sessions_seen_idx on voice_sessions (seen_at)`);
  await sql.query(`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`);
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
  const existing = (await sql<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (existing) return;
  await sql`insert into circle_members (slug, member_key, email, name, role) values (${slug}, ${key}, ${""}, ${name}, ${role})`;
}

async function touch(sql: Sql, slug: string, key: string, name: string, now: number, connected: boolean) {
  const at = stamp(now);
  await sql`
    insert into voice_sessions (slug, member_key, name, connected, joined_at, seen_at)
    values (${slug}, ${key}, ${name}, ${connected}, ${at}::timestamptz, ${at}::timestamptz)
    on conflict (slug, member_key) do update
      set name = excluded.name, connected = excluded.connected, seen_at = excluded.seen_at
  `;
}

async function membersOf(sql: Sql, slug: string) {
  return sql<{ member_key: string; name: string }>`select member_key, name from circle_members where slug = ${slug}`;
}

function peopleFrom(members: { member_key: string; name: string }[], identities: string[]) {
  const names = new Map(members.map((member) => [member.member_key, cleanName(member.name) || "Guest"]));
  const people: RosterPerson[] = [];
  for (const identity of identities) {
    const name = names.get(identity);
    if (!name) continue;
    people.push({ memberKey: identity, name });
  }
  return visibleMics(people);
}

export async function voiceOn(sql: Sql, provider: VoiceProvider, input: VoiceInput, now = Date.now()) {
  await ensureVoice(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error, configured: provider.configured };
  const cap = LIMITS[input.action] ?? 10;
  if (limited(`${who.slug}:${who.key}:${input.action}`, cap)) {
    return { ok: false as const, error: "Wait a moment, then try again.", configured: provider.configured };
  }
  const room = roomName(who.slug);
  if (input.action === "leave") {
    await sql`delete from voice_sessions where slug = ${who.slug} and member_key = ${who.key}`;
    return { ok: true as const, configured: provider.configured };
  }
  if (input.action === "beat") {
    const at = stamp(now);
    await sql`update voice_sessions set seen_at = ${at}::timestamptz where slug = ${who.slug} and member_key = ${who.key}`;
    return { ok: true as const, configured: provider.configured };
  }
  if (input.action === "token") {
    if (!provider.configured) {
      return { ok: false as const, error: "Voice chat isn't available in this wedding yet.", configured: false };
    }
    const token = await provider.signMember(who.key, who.name, room);
    await touch(sql, who.slug, who.key, who.name, now, true);
    return { ok: true as const, configured: true, url: provider.url, token, room, expiresIn: 15 * 60 };
  }
  if (input.action === "publish") {
    if (!provider.configured) return { ok: false as const, error: "Voice chat isn't available in this wedding yet.", configured: false };
    const updated = await provider.allowPublish(room, who.key, input.publish);
    if (!updated.ok) return { ok: false as const, error: updated.error, configured: true };
    await touch(sql, who.slug, who.key, who.name, now, true);
    return { ok: true as const, configured: true };
  }
  if (input.action === "roster") {
    const cutoff = stamp(now - SESSION_STALE_MS);
    await sql`delete from voice_sessions where seen_at < ${cutoff}::timestamptz`;
    if (!provider.configured) return { ok: true as const, configured: false, people: [] as RosterPerson[] };
    const listed = await provider.speakers(room);
    let identities: string[] = [];
    if (listed.ok) {
      identities = listed.identities;
      speakerCache.set(room, { at: now, identities });
    } else {
      const cached = speakerCache.get(room);
      if (!cached || now - cached.at > ROSTER_CACHE_MS) return { ok: true as const, configured: true, people: [] as RosterPerson[], delayed: true };
      identities = cached.identities;
    }
    const people = peopleFrom(await membersOf(sql, who.slug), identities);
    return { ok: true as const, configured: true, people };
  }
  return { ok: false as const, error: "That voice request was not recognised.", configured: provider.configured };
}
