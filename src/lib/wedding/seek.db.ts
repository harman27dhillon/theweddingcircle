import { randomBytes } from "node:crypto";
import { canView } from "./access";
import { decideSeek, ruleAllowsGroup, type SeekSource } from "./seek/engine";
import { seekMention } from "./seek/normalizer";
import type { FeedPost, Task, Wedding } from "./types";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query?<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  unsafe?: (text: string) => Promise<unknown>;
};

export type SeekActor = { slug: string; memberKey: string; name: string; role: "host" | "cohost" | "family" | "guest" };

const SLUG = /^[a-z0-9-]{3,80}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export async function ensureSeek(sql: Sql) {
  const run = async (text: string) => {
    if (sql.query) await sql.query(text);
    else await sql.unsafe?.(text);
  };
  if (!sql.query && !sql.unsafe) return;
  const file = [
    `create table if not exists seek_group_settings (slug text primary key, mode text not null default 'QUIET', allow_completion_announcements boolean not null default false, max_spontaneous_per_hour integer not null default 4, updated_at timestamptz not null default now())`,
    `create table if not exists seek_member_preferences (slug text not null, member_key text not null, allow_spontaneous boolean not null default false, allow_photo_comments boolean not null default false, preferred_language text, muted boolean not null default false, updated_at timestamptz not null default now(), primary key (slug, member_key))`,
    `create table if not exists seek_conversation_state (slug text not null, member_key text not null, topic text not null default '', intent text not null default '', payload jsonb not null default '{}', expires_at timestamptz not null, updated_at timestamptz not null default now(), primary key (slug, member_key))`,
    `create table if not exists seek_processed_events (event_id text primary key, slug text not null, trigger_message_id text not null, status text not null, response_id text, error_code text, processed_at timestamptz not null default now(), unique (slug, trigger_message_id))`,
    `create table if not exists seek_pending_actions (id text primary key, slug text not null, member_key text not null, action_type text not null, payload jsonb not null, expires_at timestamptz not null, status text not null default 'pending', idempotency_key text not null unique, created_at timestamptz not null default now())`,
    `create table if not exists seek_response_history (id text primary key, slug text not null, member_key text, template_id text not null, category text not null, created_at timestamptz not null default now())`,
    `create table if not exists seek_private_turns (id text primary key, slug text not null, member_key text not null, query text not null, answer text not null, sources jsonb not null default '[]', created_at timestamptz not null default now())`,
  ];
  for (const statement of file) await run(statement);
}

type SqlUnsafe = Sql & { unsafe?: (text: string) => Promise<unknown> };

export async function seekActor(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string }): Promise<SeekActor | { error: string }> {
  const slug = input.slug.trim().toLowerCase();
  const key = input.memberKey.trim();
  const name = input.name.replace(/[<>]/g, "").trim().slice(0, 80);
  if (!SLUG.test(slug)) return { error: "That wedding was not found." };
  if (!name || name.toLowerCase() === "seek") return { error: "Sign in on this phone before asking Seek." };
  if (!KEY.test(key)) return { error: "Join this wedding before asking Seek." };
  const rows = await sql<{ edit_key: string }>`select edit_key from circles where slug = ${slug} limit 1`;
  const row = rows[0];
  if (!row) return { error: "This wedding is not on the circle yet." };
  if (input.editKey.length >= 16 && row.edit_key === input.editKey) return { slug, memberKey: key, name, role: "host" };
  const member = (await sql<{ role: string; name: string }>`select role, name from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (!member || !["host", "cohost", "family", "guest"].includes(member.role)) return { error: "Join this wedding before asking Seek." };
  const role = member.role as SeekActor["role"];
  return { slug, memberKey: key, name: member.name || name, role };
}

function payloadOf(value: unknown): Wedding | null {
  const parsed = typeof value === "string" ? JSON.parse(value) as Wedding : value as Wedding;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.posts)) return null;
  return parsed;
}

async function loadWedding(sql: Sql, slug: string) {
  const row = (await sql<{ payload: unknown }>`select payload from circles where slug = ${slug} limit 1`)[0];
  if (!row) return null;
  return payloadOf(row.payload);
}

async function settings(sql: Sql, slug: string): Promise<{ mode: "QUIET" | "SOCIAL" | "PARTY"; cap: number }> {
  const row = (await sql<{ mode: string; max_spontaneous_per_hour: number }>`select mode, max_spontaneous_per_hour from seek_group_settings where slug = ${slug} limit 1`)[0];
  const mode = row?.mode === "SOCIAL" || row?.mode === "PARTY" ? row.mode : "QUIET";
  return { mode, cap: Number(row?.max_spontaneous_per_hour ?? 4) };
}

async function prefs(sql: Sql, slug: string, key: string) {
  const row = (await sql<{ allow_photo_comments: boolean; muted: boolean; preferred_language: string | null }>`select allow_photo_comments, muted, preferred_language from seek_member_preferences where slug = ${slug} and member_key = ${key} limit 1`)[0];
  return { allowPhoto: Boolean(row?.allow_photo_comments), muted: Boolean(row?.muted), language: row?.preferred_language ?? null };
}

async function stateOf(sql: Sql, slug: string, key: string, now: number) {
  const row = (await sql<{ intent: string; payload: unknown; expires_at: string | Date }>`select intent, payload, expires_at from seek_conversation_state where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (!row) return null;
  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= now) return null;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as { hits?: SeekSource[] } : row.payload as { hits?: SeekSource[] };
  return { intent: row.intent, hits: payload?.hits ?? [], expiresAt };
}

async function recentTemplates(sql: Sql, slug: string) {
  const rows = await sql<{ template_id: string }>`select template_id from seek_response_history where slug = ${slug} order by created_at desc limit 6`;
  return rows.map((row) => row.template_id);
}

function nid(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

async function saveTurn(sql: Sql, slug: string, key: string, query: string, answer: string, sources: SeekSource[], eventId: string) {
  const id = nid("sk");
  const inserted = await sql<{ id: string }>`
    insert into seek_processed_events (event_id, slug, trigger_message_id, status, response_id)
    values (${eventId}, ${slug}, ${eventId}, ${"done"}, ${id})
    on conflict (event_id) do nothing
    returning response_id
  `;
  if (!inserted[0]) {
    const prior = (await sql<{ response_id: string }>`select response_id from seek_processed_events where event_id = ${eventId} limit 1`)[0];
    const turn = prior?.response_id
      ? (await sql<{ id: string; answer: string; sources: unknown }>`select id, answer, sources from seek_private_turns where id = ${prior.response_id} limit 1`)[0]
      : undefined;
    const sources = turn ? (typeof turn.sources === "string" ? JSON.parse(turn.sources) : turn.sources) : [];
    return { id: turn?.id ?? prior?.response_id ?? "", answer: turn?.answer ?? "", sources: sources as SeekSource[], duplicate: true };
  }
  await sql`
    insert into seek_private_turns (id, slug, member_key, query, answer, sources)
    values (${id}, ${slug}, ${key}, ${query}, ${answer}, ${JSON.stringify(sources)}::jsonb)
  `;
  return { id, answer, sources, duplicate: false };
}

export async function askSeekOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; text: string; eventId: string }, now = Date.now()) {
  await ensureSeek(sql as SqlUnsafe);
  const who = await seekActor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const mention = seekMention(input.text);
  if (mention === null) return { ok: false as const, error: "Write @seek and a question." };
  if (mention === "start who said it") return { ok: true as const, kind: "game" as const };
  const eventId = input.eventId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (eventId.length < 8) return { ok: false as const, error: "That Seek request could not be saved." };
  const prior = (await sql<{ response_id: string }>`select response_id from seek_processed_events where event_id = ${eventId} limit 1`)[0];
  if (prior?.response_id) {
    const turn = (await sql<{ answer: string; sources: unknown }>`select answer, sources from seek_private_turns where id = ${prior.response_id} and slug = ${who.slug} and member_key = ${who.memberKey} limit 1`)[0];
    if (turn) {
      const sources = typeof turn.sources === "string" ? JSON.parse(turn.sources) : turn.sources;
      return { ok: true as const, kind: "private" as const, id: prior.response_id, answer: turn.answer, sources: sources as SeekSource[], duplicate: true };
    }
  }
  const wedding = await loadWedding(sql, who.slug);
  if (!wedding) return { ok: false as const, error: "This wedding is not on the circle yet." };
  const mode = await settings(sql, who.slug);
  const pref = await prefs(sql, who.slug, who.memberKey);
  const decision = decideSeek({
    text: input.text,
    now,
    explicit: true,
    hasPhoto: false,
    wedding,
    viewer: { name: who.name, role: who.role === "host" || who.role === "cohost" ? who.role : "guest" },
    mode: mode.mode,
    allowPhoto: pref.allowPhoto,
    muted: pref.muted,
    language: pref.language,
    recentTemplateIds: await recentTemplates(sql, who.slug),
    state: await stateOf(sql, who.slug, who.memberKey, now),
  });
  if (decision.intent === "CONFIRM") {
    const pending = (await sql<{ id: string; action_type: string; payload: unknown }>`
      select id, action_type, payload from seek_pending_actions
      where slug = ${who.slug} and member_key = ${who.memberKey} and status = 'pending' and expires_at > now()
      order by created_at desc limit 1
    `)[0];
    if (!pending) return { ok: false as const, error: "There is nothing waiting to confirm." };
    const payload = typeof pending.payload === "string" ? JSON.parse(pending.payload) as Record<string, string> : pending.payload as Record<string, string>;
    const applied = await applyAction(sql, who, pending.action_type, payload);
    if (!applied.ok) return applied;
    await sql`update seek_pending_actions set status = 'done' where id = ${pending.id} and status = 'pending'`;
    const saved = await saveTurn(sql, who.slug, who.memberKey, input.text.slice(0, 500), applied.reply, [], eventId);
    return { ok: true as const, kind: "private" as const, ...saved, post: applied.post };
  }
  if (decision.needsConfirm && decision.action) {
    if (decision.action.type === "set-mode" && who.role !== "host" && who.role !== "cohost") {
      return { ok: false as const, error: "Only a host can change Seek's group mode." };
    }
    const idem = `${who.slug}:${who.memberKey}:${decision.action.type}:${JSON.stringify(decision.action.payload)}`.slice(0, 180);
    await sql`
      insert into seek_pending_actions (id, slug, member_key, action_type, payload, expires_at, status, idempotency_key)
      values (${nid("pa")}, ${who.slug}, ${who.memberKey}, ${decision.action.type}, ${JSON.stringify(decision.action.payload)}::jsonb, ${new Date(now + 10 * 60_000).toISOString()}::timestamptz, ${"pending"}, ${idem})
      on conflict (idempotency_key) do nothing
    `;
  }
  if (decision.nextState) {
    await sql`
      insert into seek_conversation_state (slug, member_key, topic, intent, payload, expires_at)
      values (${who.slug}, ${who.memberKey}, ${decision.intent}, ${decision.intent}, ${JSON.stringify({ hits: decision.nextState.hits })}::jsonb, ${new Date(decision.nextState.expiresAt).toISOString()}::timestamptz)
      on conflict (slug, member_key) do update set intent = excluded.intent, payload = excluded.payload, expires_at = excluded.expires_at, updated_at = now()
    `;
  }
  if (decision.templateId) {
    await sql`insert into seek_response_history (id, slug, member_key, template_id, category) values (${nid("rh")}, ${who.slug}, ${who.memberKey}, ${decision.templateId}, ${decision.intent})`;
  }
  const saved = await saveTurn(sql, who.slug, who.memberKey, input.text.slice(0, 500), decision.reply, decision.sources, eventId);
  return { ok: true as const, kind: "private" as const, id: saved.id, answer: saved.answer || decision.reply, sources: saved.sources.length ? saved.sources : decision.sources, duplicate: saved.duplicate };
}

async function applyAction(sql: Sql, who: SeekActor, type: string, payload: Record<string, string>) {
  if (type === "set-mode") {
    const mode = payload.mode === "SOCIAL" || payload.mode === "PARTY" ? payload.mode : "QUIET";
    if (who.role !== "host" && who.role !== "cohost") return { ok: false as const, error: "Only a host can change Seek's group mode." };
    await sql`
      insert into seek_group_settings (slug, mode) values (${who.slug}, ${mode})
      on conflict (slug) do update set mode = excluded.mode, updated_at = now()
    `;
    return { ok: true as const, reply: `Seek mode is now ${mode}.`, post: null };
  }
  if (type === "opt-in") {
    const on = payload.on === "1";
    await sql`
      insert into seek_member_preferences (slug, member_key, allow_spontaneous, allow_photo_comments)
      values (${who.slug}, ${who.memberKey}, ${on}, ${on})
      on conflict (slug, member_key) do update set allow_spontaneous = excluded.allow_spontaneous, allow_photo_comments = excluded.allow_photo_comments, updated_at = now()
    `;
    return { ok: true as const, reply: on ? "Photo comments are on for you." : "I will wait for @seek.", post: null };
  }
  if (type === "add-task") {
    const title = (payload.title || "Task").slice(0, 80);
    const owner = (payload.owner || who.name).slice(0, 80);
    const when = (payload.when || "This week").slice(0, 40);
    const task: Task = { id: nid("task"), title, owner, when, done: false, category: "Ceremony arrangements" };
    const post = await mutateWedding(sql, who.slug, (wedding) => ({ ...wedding, tasks: [...(wedding.tasks ?? []), task] }));
    if (!post) return { ok: false as const, error: "The checklist could not be saved." };
    return { ok: true as const, reply: `Saved “${title}” for ${owner} (${when}) on the checklist. No phone reminder was sent.`, post: null };
  }
  return { ok: false as const, error: "That confirmation is not supported." };
}

async function mutateWedding(sql: Sql, slug: string, change: (wedding: Wedding) => Wedding) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = (await sql<{ payload: unknown; rev: number }>`select payload, coalesce((payload->>'rev')::int, 0) as rev from circles where slug = ${slug} limit 1`)[0];
    if (!row) return false;
    const wedding = payloadOf(row.payload);
    if (!wedding) return false;
    const next = { ...change(wedding), rev: Number(row.rev ?? wedding.rev ?? 0) + 1 };
    const saved = await sql<{ slug: string }>`
      update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
      where slug = ${slug} and coalesce((payload->>'rev')::int, 0) = ${Number(row.rev ?? 0)}
      returning slug
    `;
    if (saved[0]) return true;
  }
  return false;
}

export async function shareSeekOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; turnId: string }) {
  await ensureSeek(sql as SqlUnsafe);
  const who = await seekActor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const turn = (await sql<{ answer: string; sources: unknown }>`select answer, sources from seek_private_turns where id = ${input.turnId} and slug = ${who.slug} and member_key = ${who.memberKey} limit 1`)[0];
  if (!turn) return { ok: false as const, error: "That private Seek result is not yours." };
  const sources = (typeof turn.sources === "string" ? JSON.parse(turn.sources) : turn.sources) as SeekSource[];
  const wedding = await loadWedding(sql, who.slug);
  const safe = sources.filter((source) => {
    const post = wedding?.posts?.find((item) => item.id === source.id);
    return post ? ruleAllowsGroup(post.accessRule) && canView(wedding!, { name: who.name, role: "guest" }, post.accessRule, post.id, post.author) : true;
  });
  const body = [`Seek · Automated companion`, turn.answer, safe.length ? safe.map((item) => `${item.author}: ${item.excerpt}`).join(" · ") : ""].filter(Boolean).join("\n").slice(0, 2000);
  const post: FeedPost = {
    id: nid("skpost"),
    at: new Date().toISOString(),
    atLabel: "Now",
    author: "Seek",
    circle: "Automated companion",
    kind: "text",
    text: body,
    images: [],
    companion: true,
    reactions: [],
    comments: [],
  };
  const saved = await mutateWedding(sql, who.slug, (current) => ({ ...current, posts: [post, ...(current.posts ?? [])] }));
  if (!saved) return { ok: false as const, error: "The circle could not share that." };
  return { ok: true as const, post };
}

export async function considerSeekSocial(sql: Sql, slug: string, writer: { key: string; name: string; role: string }, post: { id?: string; text?: string; images?: string[]; author?: string } | null) {
  if (!post?.id || !post.text || writer.name.trim().toLowerCase() === "seek") return;
  if (seekMention(post.text) !== null) return;
  await ensureSeek(sql as SqlUnsafe);
  const mode = await settings(sql, slug);
  const pref = await prefs(sql, slug, writer.key);
  const wedding = await loadWedding(sql, slug);
  if (!wedding) return;
  const hour = (await sql<{ count: number }>`select count(*)::int as count from seek_response_history where slug = ${slug} and category = 'ASK_APPEARANCE' and created_at > now() - interval '1 hour'`)[0];
  if (Number(hour?.count ?? 0) >= mode.cap) return;
  const decision = decideSeek({
    text: post.text,
    now: Date.now(),
    explicit: false,
    hasPhoto: (post.images?.length ?? 0) > 0,
    wedding,
    viewer: { name: writer.name, role: writer.role === "host" || writer.role === "cohost" ? writer.role : "guest" },
    mode: mode.mode,
    allowPhoto: pref.allowPhoto,
    muted: pref.muted,
    recentTemplateIds: await recentTemplates(sql, slug),
  });
  if (!decision.social || !decision.reply) return;
  const eventId = `social_${post.id}`.slice(0, 80);
  const claimed = await sql<{ event_id: string }>`
    insert into seek_processed_events (event_id, slug, trigger_message_id, status)
    values (${eventId}, ${slug}, ${post.id}, ${"done"})
    on conflict (event_id) do nothing
    returning event_id
  `;
  if (!claimed[0]) return;
  const message: FeedPost = {
    id: nid("sknote"),
    at: new Date().toISOString(),
    atLabel: "Now",
    author: "Seek",
    circle: "Automated companion",
    kind: "text",
    text: decision.reply,
    images: [],
    companion: true,
    reactions: [],
    comments: [],
  };
  await mutateWedding(sql, slug, (current) => ({ ...current, posts: [message, ...(current.posts ?? [])] }));
  await sql`insert into seek_response_history (id, slug, member_key, template_id, category) values (${nid("rh")}, ${slug}, ${writer.key}, ${decision.templateId}, ${"ASK_APPEARANCE"})`;
}
