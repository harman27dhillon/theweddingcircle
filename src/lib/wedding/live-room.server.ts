import { compactCode, normalizeCode } from "@/lib/wedding/format";

type Kind = "offer" | "answer" | "ice";

type Payload = {
  type?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
};

type Signal = { id: number; from: string; to: string; kind: Kind; payload: Payload };
type Chat = { id: number; peerId: string; name: string; text: string; at?: number };
type Burst = { id: number; emoji: string };
type StreamInfo = { hostId: string; hostName: string };

const REACTIONS = new Set(["❤️", "🥰", "💍", "🥳", "💃", "🕺", "🎉", "🌸", "🧿", "👏"]);
const MAX_STREAMS = 1;

type Room = {
  hostId: string;
  hostName: string;
  memberKey: string;
  allow: Set<string>;
  hostSeen: number;
  signals: Signal[];
  seq: number;
  viewers: Map<string, number>;
  chats: Chat[];
  bursts: Burst[];
  chatAt: Map<string, number>;
  reactAt: Map<string, number>;
  allowNames: Set<string> | null;
  startedAt: number;
};

type LiveInput = {
  action: string;
  slug: string;
  peerId: string;
  name: string;
  code: string;
  codes: string[];
  to: string;
  kind: string;
  payload: unknown;
  after: number;
  text?: string;
  memberKey?: string;
  access?: string;
  roster?: string;
  stream?: string;
  watch?: string;
};

const rooms: Map<string, Room> = ((globalThis as unknown as { __wcLiveRooms?: Map<string, Room> }).__wcLiveRooms ??= new Map());
const endedAt: Map<string, number> = ((globalThis as unknown as { __wcLiveEnded?: Map<string, number> }).__wcLiveEnded ??= new Map());

function roomKey(slug: string, hostId: string) {
  return `${slug}:${hostId}`;
}

function allowSet(list: string[]) {
  return new Set(list.map((item) => compactCode(normalizeCode(item))).filter((item) => item.length >= 4));
}

function permitted(room: Room, code: string) {
  return room.allow.has(compactCode(normalizeCode(code)));
}

function canWatch(room: Room, input: { peerId: string; code: string; codes: string[] }, member: { role: string } | null) {
  if (room.hostId === input.peerId) return true;
  if (member && (member.role === "host" || member.role === "cohost" || member.role === "family" || member.role === "guest")) return true;
  return [input.code, ...input.codes].some((code) => permitted(room, code));
}

function canBroadcastRole(role: string) {
  return role === "host" || role === "cohost" || role === "family";
}

function payloadOf(value: unknown): Payload | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const payload: Payload = {};
  if (typeof body.type === "string") payload.type = body.type.slice(0, 20);
  if (typeof body.sdp === "string") payload.sdp = body.sdp.slice(0, 20000);
  if (typeof body.candidate === "string") payload.candidate = body.candidate.slice(0, 2000);
  if (typeof body.sdpMid === "string" || body.sdpMid === null) payload.sdpMid = body.sdpMid;
  if (typeof body.sdpMLineIndex === "number") payload.sdpMLineIndex = body.sdpMLineIndex;
  if (!payload.type && !payload.sdp && !payload.candidate) return null;
  return payload;
}

function quiet(streams: StreamInfo[] = []) {
  return {
    ok: true as const,
    live: false,
    signaling: false,
    hostId: "",
    hostName: "",
    signals: [] as Signal[],
    viewerCount: 0,
    chats: [] as Chat[],
    bursts: [] as Burst[],
    streams,
    startedAt: 0,
  };
}

function view(room: Room, signals: Signal[] = [], signaling = true, streams: StreamInfo[] = []) {
  const now = Date.now();
  let viewerCount = 0;
  for (const [id, seen] of room.viewers) {
    if (id !== room.hostId && now - seen < 10000) viewerCount += 1;
    else if (now - seen >= 10000) room.viewers.delete(id);
  }
  return {
    ok: true as const,
    live: true,
    signaling,
    hostId: room.hostId,
    hostName: room.hostName,
    signals,
    viewerCount,
    chats: room.chats,
    bursts: room.bursts,
    streams,
    startedAt: room.startedAt,
  };
}

let schemaReady: Promise<void> | null = null;
let sqlOverride: Awaited<ReturnType<typeof import("@/lib/db").getSql>> | null = null;

/** Test-only. The app path always uses the shared server database. */
export function bindLiveSql(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>> | null) {
  sqlOverride = sql;
  schemaReady = null;
}

async function migrateLive(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`;
  await sql`create table if not exists circle_live (
    slug text not null,
    host_name text not null,
    host_peer text not null,
    allow_codes text not null default '',
    is_private boolean not null default false,
    seen_at timestamptz not null default now(),
    member_key text not null default '',
    primary key (slug, host_peer)
  )`;
  await sql`alter table circle_live add column if not exists member_key text not null default ''`;
  const keys = await sql<{ attname: string }>`
    select a.attname as attname
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'circle_live'::regclass and i.indisprimary
  `;
  const cols = keys.map((row) => row.attname);
  const composite = cols.includes("slug") && cols.includes("host_peer");
  if (!composite) {
    if (cols.length) await sql`alter table circle_live drop constraint if exists circle_live_pkey`;
    await sql`alter table circle_live add primary key (slug, host_peer)`;
  }
  await sql`create index if not exists circle_live_slug_idx on circle_live (slug)`;
  await sql`create table if not exists circle_live_signal (
    id bigserial primary key,
    slug text not null,
    sender text not null,
    recipient text not null,
    kind text not null,
    payload jsonb not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists circle_live_signal_slug_id on circle_live_signal (slug, id)`;
  await sql`create table if not exists circle_live_chat (
    id bigserial primary key,
    slug text not null,
    host_peer text not null,
    peer_id text not null,
    name text not null,
    body text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create index if not exists circle_live_chat_room on circle_live_chat (slug, host_peer, id)`;
}

async function ensureLiveTables() {
  if (sqlOverride) {
    const sql = sqlOverride;
    if (!schemaReady) {
      schemaReady = migrateLive(sql).catch((error) => {
        schemaReady = null;
        throw error;
      });
    }
    await schemaReady;
    return sql;
  }
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  if (!schemaReady) {
    schemaReady = migrateLive(sql).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return sql;
}

function isPrivate(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

type LiveRow = { host_name: string; host_peer: string; allow_codes: string; is_private: boolean; member_key: string };

async function readLiveRows(slug: string) {
  const sql = await ensureLiveTables();
  await sql`delete from circle_live where seen_at < now() - interval '20 seconds'`;
  return sql<LiveRow>`
    select host_name, host_peer, allow_codes, is_private, member_key from circle_live
    where slug = ${slug}
    order by seen_at asc, host_peer asc
  `;
}

async function memberOf(slug: string, memberKey: string) {
  if (!memberKey) return null;
  try {
    const sql = sqlOverride ?? await (await import("@/lib/developer/core-route.server")).weddingDataSql();
    const rows = await sql<{ name: string; role: string }>`select name, role from circle_members where slug = ${slug} and member_key = ${memberKey} limit 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function allowNames(access: string, roster: string) {
  let rule: { kind?: string; names?: string[]; ceremonyId?: string } = {};
  try {
    rule = JSON.parse(access || "{}") as typeof rule;
  } catch {
    rule = {};
  }
  if (!rule.kind || rule.kind === "all") return null;
  let people: { name?: string; side?: string; allowBride?: boolean; allowGroom?: boolean; allowCeremonies?: string[] }[] = [];
  try {
    const parsed = JSON.parse(roster || "[]") as unknown;
    if (Array.isArray(parsed)) people = parsed.slice(0, 400);
  } catch {
    people = [];
  }
  const listed = new Set((rule.names ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean));
  const names = new Set<string>(listed);
  for (const guest of people) {
    const name = guest.name?.trim().toLowerCase() ?? "";
    if (!name) continue;
    if (rule.kind === "people" && listed.has(name)) names.add(name);
    if (rule.kind === "bride" && (guest.side === "Bride" || guest.side === "Both" || guest.allowBride)) names.add(name);
    if (rule.kind === "groom" && (guest.side === "Groom" || guest.side === "Both" || guest.allowGroom)) names.add(name);
    if (rule.kind === "ceremony" && (listed.has(name) || guest.allowCeremonies?.includes(rule.ceremonyId ?? ""))) names.add(name);
  }
  return names;
}

async function admitted(room: Room, slug: string, memberKey: string) {
  if (!room.allowNames) return true;
  const member = await memberOf(slug, memberKey);
  if (!member) return false;
  if (member.role === "host" || member.role === "cohost") return true;
  return room.allowNames.has(member.name.trim().toLowerCase());
}

function expireMemory() {
  const now = Date.now();
  for (const [key, room] of rooms) {
    if (now - room.hostSeen > 20000) rooms.delete(key);
  }
}

function roomsFor(slug: string) {
  const list: Room[] = [];
  for (const [key, room] of rooms) {
    if (key.startsWith(`${slug}:`)) list.push(room);
  }
  return list;
}

function blankRoom(row: LiveRow): Room {
  return {
    hostId: row.host_peer,
    hostName: row.host_name,
    memberKey: row.member_key || "",
    allow: new Set((row.allow_codes || "").split(",").filter(Boolean)),
    hostSeen: Date.now() - 15000,
    signals: [],
    seq: 0,
    viewers: new Map(),
    chats: [],
    bursts: [],
    chatAt: new Map(),
    reactAt: new Map(),
    allowNames: null,
    startedAt: Date.now(),
  };
}

async function remember(slug: string, hostId: string) {
  const key = roomKey(slug, hostId);
  const existing = rooms.get(key);
  if (existing) return existing;
  const row = (await readLiveRows(slug)).find((item) => item.host_peer === hostId);
  if (!row) return null;
  const room = blankRoom(row);
  rooms.set(key, room);
  return room;
}

async function savedChats(slug: string, hostId: string): Promise<Chat[]> {
  if (!slug || !hostId) return [];
  const sql = await ensureLiveTables();
  await sql`delete from circle_live_chat where created_at < now() - interval '90 seconds'`;
  const rows = await sql<{ id: number | string; peer_id: string; name: string; body: string; at: number | string }>`
    select id, peer_id, name, body, extract(epoch from created_at) * 1000 as at
    from circle_live_chat
    where slug = ${slug} and host_peer = ${hostId} and created_at > now() - interval '70 seconds'
    order by id asc
  `;
  return rows.map((row) => ({
    id: Number(row.id),
    peerId: row.peer_id,
    name: row.name,
    text: row.body,
    at: Number(row.at) || 0,
  }));
}

export function clearLiveRooms() {
  rooms.clear();
}

async function dropStream(slug: string, hostId: string) {
  rooms.delete(roomKey(slug, hostId));
  const sql = await ensureLiveTables();
  await sql`delete from circle_live where slug = ${slug} and host_peer = ${hostId}`;
  await sql`delete from circle_live_signal where slug = ${slug} and (sender = ${hostId} or recipient = ${hostId})`;
  await sql`delete from circle_live_chat where slug = ${slug} and host_peer = ${hostId}`;
}

function listed(rows: LiveRow[]): StreamInfo[] {
  return rows.slice(0, MAX_STREAMS).map((row) => ({ hostId: row.host_peer, hostName: row.host_name }));
}

async function claimStream(slug: string, peerId: string, memberKey: string, name: string, codes: string[], isPrivateRoom: boolean) {
  const sql = await ensureLiveTables();
  const stale = await sql<{ host_peer: string }>`
    delete from circle_live
    where slug = ${slug} and seen_at < now() - interval '20 seconds'
    returning host_peer
  `;
  for (const row of stale) {
    rooms.delete(roomKey(slug, row.host_peer));
    endedAt.set(roomKey(slug, row.host_peer), Date.now());
  }
  const already = await sql<{ host_peer: string }>`select host_peer from circle_live where slug = ${slug} and host_peer = ${peerId} limit 1`;
  if (!already[0]) {
    const other = await sql<{ host_peer: string }>`select host_peer from circle_live where slug = ${slug} and host_peer <> ${peerId} limit 1`;
    if (other[0]) return false;
  }
  const allow = [...allowSet(codes)].join(",");
  await sql`
    insert into circle_live (slug, host_name, host_peer, allow_codes, is_private, seen_at, member_key)
    values (${slug}, ${name}, ${peerId}, ${allow}, ${isPrivateRoom}, now(), ${memberKey})
    on conflict (slug, host_peer) do update
    set host_name = excluded.host_name,
        allow_codes = excluded.allow_codes,
        is_private = excluded.is_private,
        seen_at = now(),
        member_key = excluded.member_key
  `;
  return true;
}

function signalList(rows: { id: number | string; sender: string; recipient: string; kind: string; payload: unknown }[]) {
  const signals: Signal[] = [];
  for (const row of rows) {
    let raw = row.payload;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        raw = null;
      }
    }
    const payload = payloadOf(raw);
    if (!payload || (row.kind !== "offer" && row.kind !== "answer" && row.kind !== "ice")) continue;
    signals.push({ id: Number(row.id), from: row.sender, to: row.recipient, kind: row.kind, payload });
  }
  return signals;
}

async function inbox(slug: string, peerId: string, after: number) {
  const sql = await ensureLiveTables();
  await sql`delete from circle_live_signal where created_at < now() - interval '45 seconds'`;
  const rows = await sql<{ id: number | string; sender: string; recipient: string; kind: string; payload: unknown }>`
    select id, sender, recipient, kind, payload from circle_live_signal
    where slug = ${slug} and recipient = ${peerId} and id > ${after}
    order by id
    limit 40
  `;
  return signalList(rows);
}

function owns(room: Room, peerId: string, memberKey: string) {
  if (room.hostId === peerId) return true;
  return Boolean(memberKey) && room.memberKey === memberKey;
}

async function visibleRows(slug: string, input: LiveInput, member: { role: string; name: string } | null) {
  const rows = await readLiveRows(slug);
  const visible: LiveRow[] = [];
  for (const row of rows) {
    const coded = [input.code, ...input.codes].some((code) => {
      const allow = new Set((row.allow_codes || "").split(",").filter(Boolean));
      return allow.has(compactCode(normalizeCode(code)));
    });
    if (!member && !coded) continue;
    if (isPrivate(row.is_private) && !member) continue;
    const room = rooms.get(roomKey(slug, row.host_peer));
    if (room && !(await admitted(room, slug, input.memberKey ?? ""))) continue;
    visible.push(row);
  }
  return visible;
}

export async function liveRoom(input: LiveInput) {
  expireMemory();
  const slug = input.slug.trim().toLowerCase();
  const peerId = input.peerId.trim();
  const streamId = (input.stream ?? "").trim();
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || !/^[a-zA-Z0-9_-]{6,80}$/.test(peerId)) {
    return { ok: false as const, error: "This wedding cannot go live." };
  }
  if (sqlOverride) await ensureLiveTables();

  if (input.action === "start") {
    if (slug === "lila-nico") return { ok: false as const, error: "The sample circle stays on this phone, so other guests cannot join its camera." };
    const member = await memberOf(slug, input.memberKey ?? "");
    if (!member || !canBroadcastRole(member.role)) {
      return { ok: false as const, error: "Only a host, co-host, or family member can go live." };
    }
    const allow = allowSet(input.codes);
    if (!allow.size) return { ok: false as const, error: "This wedding has no entry code." };
    const stamp = roomKey(slug, peerId);
    const issued = input.after > 1e11 ? input.after : 0;
    if (issued && issued <= (endedAt.get(stamp) ?? 0)) return quiet(listed(await readLiveRows(slug)));
    const existing = rooms.get(stamp);
    if (existing && existing.hostId === peerId && issued && existing.startedAt > issued) return view(existing, [], true, listed(await readLiveRows(slug)));
    const hostName = member.name.trim().slice(0, 80) || "Member";
    const names = allowNames(input.access ?? "", input.roster ?? "");
    const kept = await claimStream(slug, peerId, input.memberKey ?? "", hostName, input.codes, Boolean(names));
    if (!kept) {
      rooms.delete(stamp);
      return { ok: false as const, error: "This wedding already has a live stream. End it before starting another." };
    }
    const room: Room = {
      hostId: peerId,
      hostName,
      memberKey: input.memberKey ?? "",
      allow,
      hostSeen: Date.now(),
      signals: [],
      seq: existing?.seq ?? 0,
      viewers: existing?.viewers ?? new Map(),
      chats: existing?.chats ?? [],
      bursts: existing?.bursts ?? [],
      chatAt: existing?.chatAt ?? new Map(),
      reactAt: existing?.reactAt ?? new Map(),
      allowNames: names,
      startedAt: issued || existing?.startedAt || Date.now(),
    };
    rooms.set(stamp, room);
    const sql = await ensureLiveTables();
    await sql`delete from circle_live_signal where slug = ${slug} and (sender = ${peerId} or recipient = ${peerId})`;
    return view(room, [], true, listed(await readLiveRows(slug)));
  }

  const member = await memberOf(slug, input.memberKey ?? "");

  if (input.action === "streams") {
    const rows = await visibleRows(slug, input, member);
    if (!rows.length && !member) {
      const any = await readLiveRows(slug);
      if (any.length) return { ok: false as const, error: "Only people in this wedding can watch." };
    }
    return { ...quiet(listed(rows)), live: rows.length > 0, signaling: true };
  }

  if (input.action === "stop") {
    const target = streamId || peerId;
    if (input.after > 1e11) endedAt.set(roomKey(slug, target), Math.max(endedAt.get(roomKey(slug, target)) ?? 0, input.after));
    const room = (await remember(slug, target)) ?? rooms.get(roomKey(slug, target)) ?? null;
    if (room && !owns(room, peerId, input.memberKey ?? "")) {
      return { ok: false as const, error: "Only the person who started this live can stop it." };
    }
    if (room) await dropStream(slug, target);
    return quiet(listed(await visibleRows(slug, input, member)));
  }

  if (input.action === "leave") {
    const sql = await ensureLiveTables();
    await sql`delete from circle_live_signal where slug = ${slug} and (sender = ${peerId} or recipient = ${peerId})`;
    for (const room of roomsFor(slug)) room.viewers.delete(peerId);
    return quiet(listed(await visibleRows(slug, input, member)));
  }

  if (input.action === "board") {
    const rows = await visibleRows(slug, input, member);
    if (!rows.length && !member) {
      const any = await readLiveRows(slug);
      if (any.length) return { ok: false as const, error: "Only people in this wedding can watch." };
    }
    const watching = new Set(
      (input.watch ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => /^[a-zA-Z0-9_-]{6,80}$/.test(item)),
    );
    const now = Date.now();
    for (const id of watching) {
      if (id === peerId) continue;
      const room = rooms.get(roomKey(slug, id)) ?? (await remember(slug, id));
      if (room) room.viewers.set(peerId, now);
    }
    let focusId = streamId && rows.some((row) => row.host_peer === streamId) ? streamId : "";
    if (!focusId && rows.length === 1) focusId = rows[0].host_peer;
    const focus = focusId ? (rooms.get(roomKey(slug, focusId)) ?? (await remember(slug, focusId))) : null;
    const signals = await inbox(slug, peerId, input.after);
    const streams = listed(rows);
    if (!focus) return { ...quiet(streams), live: streams.length > 0, signaling: true, signals, ended: Boolean(streamId) && !focusId };
    return { ...view(focus, signals, true, streams), chats: await savedChats(slug, focus.hostId), ended: false };
  }

  let resolvedStream = streamId;
  if (!resolvedStream) {
    const ownRows = await readLiveRows(slug);
    if (rooms.get(roomKey(slug, peerId)) || ownRows.some((row) => row.host_peer === peerId)) resolvedStream = peerId;
  }
  const target = resolvedStream;
  let room = target ? await remember(slug, target) : null;
  if (!room && !target) {
    const rows = await visibleRows(slug, input, member);
    if (rows.length === 1) room = await remember(slug, rows[0].host_peer);
  }
  if (!room) {
    const rows = await visibleRows(slug, input, member);
    return { ...quiet(listed(rows)), ended: Boolean(target) };
  }
  if (!(await admitted(room, slug, input.memberKey ?? ""))) {
    return { ok: false as const, error: "This live is private." };
  }
  if (!canWatch(room, input, member)) return { ok: false as const, error: "Only people in this wedding can watch." };

  const streams = listed(await visibleRows(slug, input, member));
  const host = room.hostId === peerId;

  if (input.action === "signal") {
    const kind = input.kind === "offer" || input.kind === "answer" || input.kind === "ice" ? input.kind : "";
    const to = input.to.trim().slice(0, 80);
    const payload = payloadOf(input.payload);
    if (!kind || !to || !payload) return { ok: false as const, error: "The stream could not connect." };
    const sql = await ensureLiveTables();
    await sql`insert into circle_live_signal (slug, sender, recipient, kind, payload) values (${slug}, ${peerId}, ${to}, ${kind}, ${JSON.stringify(payload)}::jsonb)`;
    if (host) room.hostSeen = Date.now();
    return view(room, [], true, streams);
  }

  if (input.action === "comment") {
    const text = (input.text ?? "").trim().slice(0, 240);
    if (!text) return { ok: false as const, error: "Write a comment." };
    const last = room.chatAt.get(peerId) ?? 0;
    if (Date.now() - last < 1500) return { ok: false as const, error: "Wait a moment before another comment." };
    room.chatAt.set(peerId, Date.now());
    const name = input.name.trim().slice(0, 80) || "Guest";
    const sql = await ensureLiveTables();
    const inserted = await sql<{ id: number | string; at: number | string }>`
      insert into circle_live_chat (slug, host_peer, peer_id, name, body)
      values (${slug}, ${room.hostId}, ${peerId}, ${name}, ${text})
      returning id, extract(epoch from created_at) * 1000 as at
    `;
    const row = inserted[0];
    if (row) {
      room.chats.push({ id: Number(row.id), peerId, name, text, at: Number(row.at) || Date.now() });
      if (room.chats.length > 40) room.chats.splice(0, room.chats.length - 40);
    }
    if (host) room.hostSeen = Date.now();
    else room.viewers.set(peerId, Date.now());
    return { ...view(room, [], true, streams), chats: await savedChats(slug, room.hostId) };
  }

  if (input.action === "react") {
    const emoji = (input.text ?? "").trim();
    if (!REACTIONS.has(emoji)) return { ok: false as const, error: "That reaction is not available." };
    const last = room.reactAt.get(peerId) ?? 0;
    if (Date.now() - last < 500) return view(room, [], true, streams);
    room.reactAt.set(peerId, Date.now());
    room.seq += 1;
    room.bursts.push({ id: room.seq, emoji });
    if (room.bursts.length > 40) room.bursts.splice(0, room.bursts.length - 40);
    if (host) room.hostSeen = Date.now();
    else room.viewers.set(peerId, Date.now());
    return view(room, [], true, streams);
  }

  if (input.action === "drop") {
    if (!host) return { ok: false as const, error: "Only the broadcaster can remove a comment." };
    const id = Number(input.to);
    room.chats = room.chats.filter((item) => item.id !== id);
    const sql = await ensureLiveTables();
    await sql`delete from circle_live_chat where slug = ${slug} and host_peer = ${room.hostId} and id = ${id}`;
    room.hostSeen = Date.now();
    return { ...view(room, [], true, streams), chats: await savedChats(slug, room.hostId) };
  }

  if (input.action === "poll") {
    if (host) {
      room.hostSeen = Date.now();
      const sql = await ensureLiveTables();
      await sql`update circle_live set seen_at = now() where slug = ${slug} and host_peer = ${peerId}`;
    } else room.viewers.set(peerId, Date.now());
    const signals = await inbox(slug, peerId, input.after);
    return { ...view(room, signals, true, streams), chats: await savedChats(slug, room.hostId) };
  }

  return { ok: false as const, error: "The stream could not connect." };
}
