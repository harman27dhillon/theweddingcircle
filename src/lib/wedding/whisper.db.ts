import { randomBytes } from "node:crypto";
import { cleanWhisperBody, whisperFor, WHISPER_MS, type WhisperRow, type WhisperView } from "./whisper";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query?<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const SLUG = /^[a-z0-9-]{3,80}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type WhisperActor = { slug: string; memberKey: string; name: string; role: "host" | "cohost" | "guest" };

export async function ensureWhispers(sql: Sql) {
  if (!sql.query) return;
  await sql.query(`create table if not exists whispers (
    id text primary key,
    slug text not null,
    parent_post_id text not null,
    parent_excerpt text not null default '',
    reply_to text,
    sender_key text not null,
    sender_name text not null,
    recipient_key text not null,
    recipient_name text not null,
    body text not null default '',
    created_at timestamptz not null default now(),
    first_revealed_at timestamptz,
    expires_at timestamptz,
    deleted_at timestamptz
  )`);
}

function nid() {
  return `wh_${randomBytes(8).toString("hex")}`;
}

function at(value: unknown) {
  if (!value) return null;
  const time = new Date(value as string).getTime();
  return Number.isNaN(time) ? null : time;
}

async function actor(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string }): Promise<WhisperActor | { error: string }> {
  const slug = input.slug.trim().toLowerCase();
  const key = input.memberKey.trim();
  const name = input.name.replace(/[<>]/g, "").trim().slice(0, 80);
  if (!SLUG.test(slug) || !KEY.test(key) || !name || name.toLowerCase() === "seek") return { error: "Join this wedding before sending a Whisper." };
  const row = (await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`)[0];
  if (!row) return { error: "This wedding is not on the circle yet." };
  if (input.editKey.length >= 16 && row.edit_key === input.editKey) return { slug, memberKey: key, name, role: "host" };
  const member = (await sql<{ role: string; name: string }>`select role, name from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (member && ["host", "cohost", "family", "guest"].includes(member.role)) {
    return { slug, memberKey: key, name: member.name || name, role: member.role === "cohost" ? "cohost" : member.role === "host" ? "host" : "guest" };
  }
  const profiles = payloadOf(row.payload)?.guestProfiles as Record<string, { displayName?: string; removed?: boolean }> | undefined;
  const profile = profiles?.[key];
  if (profile && !profile.removed && profile.displayName?.trim()) return { slug, memberKey: key, name: profile.displayName.trim().slice(0, 80), role: "guest" };
  return { error: "Join this wedding before sending a Whisper." };
}

function payloadOf(value: unknown) {
  const parsed = typeof value === "string" ? JSON.parse(value) as { posts?: { id?: string; author?: string; authorId?: string; text?: string; removed?: boolean }[]; guestProfiles?: Record<string, { displayName?: string; removed?: boolean; accountId?: string }> } : value as { posts?: { id?: string; author?: string; authorId?: string; text?: string; removed?: boolean }[]; guestProfiles?: Record<string, { displayName?: string; removed?: boolean; accountId?: string }> };
  return parsed && typeof parsed === "object" ? parsed : null;
}

function authorKey(profiles: Record<string, { displayName?: string; removed?: boolean; accountId?: string }> | undefined, author: string, authorId?: string) {
  const list = Object.entries(profiles ?? {}).filter(([, profile]) => profile && !profile.removed && profile.displayName?.trim());
  if (authorId) {
    const hit = list.find(([, profile]) => profile.accountId === authorId);
    if (hit) return hit[0];
  }
  const name = author.trim().toLowerCase();
  const named = list.filter(([, profile]) => profile.displayName?.trim().toLowerCase() === name);
  return named.length === 1 ? named[0][0] : "";
}

function rowOf(record: Record<string, unknown>): WhisperRow {
  return {
    id: String(record.id),
    slug: String(record.slug),
    parentPostId: String(record.parent_post_id),
    parentExcerpt: String(record.parent_excerpt ?? ""),
    replyTo: record.reply_to ? String(record.reply_to) : undefined,
    senderKey: String(record.sender_key),
    senderName: String(record.sender_name),
    recipientKey: String(record.recipient_key),
    recipientName: String(record.recipient_name),
    body: String(record.body ?? ""),
    createdAt: at(record.created_at) ?? 0,
    firstRevealedAt: at(record.first_revealed_at),
    expiresAt: at(record.expires_at),
    deletedAt: at(record.deleted_at),
  };
}

async function sweep(sql: Sql, slug: string) {
  await sql`update whispers set body = '', parent_excerpt = '' where slug = ${slug} and expires_at is not null and expires_at <= now() and body <> ''`;
  await sql`update whispers set body = '' where slug = ${slug} and deleted_at is not null and body <> ''`;
}

export async function listWhispersOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string }, now = Date.now()) {
  await ensureWhispers(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  await sweep(sql, who.slug);
  const rows = await sql<Record<string, unknown>>`
    select * from whispers
    where slug = ${who.slug}
      and (sender_key = ${who.memberKey} or recipient_key = ${who.memberKey})
      and deleted_at is null
      and (expires_at is null or expires_at > now())
    order by created_at asc
  `;
  const whispers = rows.map((row) => whisperFor(rowOf(row), who.memberKey, now)).filter((item): item is WhisperView => Boolean(item));
  return { ok: true as const, whispers, serverNow: now };
}

export async function sendWhisperOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; parentPostId: string; recipientKey: string; body: string; replyTo?: string }, now = Date.now()) {
  await ensureWhispers(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const body = cleanWhisperBody(input.body);
  if (!body) return { ok: false as const, error: "Write a Whisper before sending it." };
  if (!KEY.test(input.recipientKey) || input.recipientKey === who.memberKey) return { ok: false as const, error: "Choose someone else in this wedding." };
  const recent = (await sql<{ count: number }>`select count(*)::int as count from whispers where slug = ${who.slug} and sender_key = ${who.memberKey} and created_at > now() - interval '1 minute'`)[0];
  if (Number(recent?.count ?? 0) >= 8) return { ok: false as const, error: "Wait a moment before another Whisper." };
  const wedding = payloadOf((await sql<{ payload: unknown }>`select payload from circles where slug = ${who.slug} limit 1`)[0]?.payload);
  if (!wedding) return { ok: false as const, error: "This wedding is not on the circle yet." };
  let parentPostId = input.parentPostId.slice(0, 80);
  let parentExcerpt = "";
  let recipientKey = input.recipientKey;
  let recipientName = "";
  if (input.replyTo) {
    const prior = (await sql<Record<string, unknown>>`select * from whispers where id = ${input.replyTo} and slug = ${who.slug} limit 1`)[0];
    const view = prior ? whisperFor(rowOf(prior), who.memberKey, now) : null;
    if (!prior || !view || view.collapsed) return { ok: false as const, error: "That Whisper is no longer available." };
    const row = rowOf(prior);
    recipientKey = row.senderKey === who.memberKey ? row.recipientKey : row.senderKey;
    recipientName = row.senderKey === who.memberKey ? row.recipientName : row.senderName;
    parentPostId = row.parentPostId;
    parentExcerpt = row.parentExcerpt;
  } else {
    const post = (wedding.posts ?? []).find((item) => item.id === parentPostId && !item.removed);
    if (!post) return { ok: false as const, error: "That message is no longer in the chat." };
    const key = authorKey(wedding.guestProfiles, post.author ?? "", post.authorId);
    if (!key || key !== recipientKey) return { ok: false as const, error: "A Whisper can only go to the person who wrote that message." };
    recipientName = (wedding.guestProfiles?.[key]?.displayName ?? post.author ?? "").trim().slice(0, 80);
    parentExcerpt = (post.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  if (!recipientName || recipientKey === who.memberKey) return { ok: false as const, error: "Choose someone else in this wedding." };
  const id = nid();
  await sql`
    insert into whispers (id, slug, parent_post_id, parent_excerpt, reply_to, sender_key, sender_name, recipient_key, recipient_name, body)
    values (${id}, ${who.slug}, ${parentPostId}, ${parentExcerpt}, ${input.replyTo || null}, ${who.memberKey}, ${who.name}, ${recipientKey}, ${recipientName}, ${body})
  `;
  const saved = (await sql<Record<string, unknown>>`select * from whispers where id = ${id} limit 1`)[0];
  const whisper = saved ? whisperFor(rowOf(saved), who.memberKey, now) : null;
  return whisper ? { ok: true as const, whisper, serverNow: now } : { ok: false as const, error: "That Whisper could not be saved." };
}

export async function revealWhisperOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; whisperId: string }, now = Date.now()) {
  await ensureWhispers(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const id = input.whisperId.slice(0, 40);
  await sql`
    update whispers
    set first_revealed_at = now(), expires_at = now() + interval '60 seconds'
    where id = ${id} and slug = ${who.slug} and recipient_key = ${who.memberKey} and first_revealed_at is null and deleted_at is null
  `;
  const row = (await sql<Record<string, unknown>>`select * from whispers where id = ${id} and slug = ${who.slug} limit 1`)[0];
  if (!row) return { ok: false as const, error: "That Whisper is not available." };
  const parsed = rowOf(row);
  if (parsed.senderKey !== who.memberKey && parsed.recipientKey !== who.memberKey) return { ok: false as const, error: "That Whisper is not available." };
  const whisper = whisperFor(parsed, who.memberKey, now);
  if (!whisper) return { ok: false as const, error: "That Whisper is not available." };
  return { ok: true as const, whisper, serverNow: now };
}

export async function deleteWhisperOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; whisperId: string }) {
  await ensureWhispers(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const id = input.whisperId.slice(0, 40);
  const saved = await sql<{ id: string }>`
    update whispers set deleted_at = now(), body = '', parent_excerpt = ''
    where id = ${id} and slug = ${who.slug} and sender_key = ${who.memberKey} and deleted_at is null
    returning id
  `;
  if (!saved[0]) return { ok: false as const, error: "Only the sender can delete that Whisper." };
  return { ok: true as const };
}
