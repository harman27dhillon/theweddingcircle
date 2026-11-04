import { randomBytes } from "node:crypto";
import {
  SUBMIT_MS,
  GUESS_MS,
  addStatement,
  advance,
  assignGuess,
  canLock,
  cardFor,
  cleanLine,
  lockEarly,
  ordered,
  scoreOf,
  toPublic,
  type Round,
  type Statement,
} from "./who-said.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type PlayInput = {
  slug: string;
  memberKey: string;
  editKey: string;
  name: string;
  prompt?: string;
  text?: string;
  roundId?: string;
  statementId?: string;
  token?: string;
};

const SLUG = /^[a-z0-9-]{3,80}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const hits = new Map<string, number[]>();

function limited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 40) return true;
  recent.push(now);
  hits.set(key, recent);
  return false;
}

function nid(prefix: string) {
  return `${prefix}${randomBytes(8).toString("hex")}`;
}

function millis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stamp(ms: number) {
  return new Date(ms).toISOString();
}

export async function ensureWhoSaid(sql: Sql) {
  await sql.query(`create table if not exists who_said_rounds (
    id text primary key,
    slug text not null,
    starter_key text not null,
    starter_name text not null,
    prompt text not null,
    phase text not null,
    submit_deadline timestamptz not null,
    guess_deadline timestamptz not null,
    score integer not null default 0,
    scored boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create unique index if not exists who_said_one_active on who_said_rounds (slug) where phase in ('submit', 'guess')`);
  await sql.query(`create table if not exists who_said_statements (
    id text primary key,
    round_id text not null,
    author_key text not null,
    author_name text not null,
    public_token text not null,
    body text not null,
    sort_index integer not null default 0,
    unique (round_id, author_key)
  )`);
  await sql.query(`create table if not exists who_said_guesses (
    round_id text not null,
    statement_id text not null,
    guess_key text not null,
    primary key (round_id, statement_id)
  )`);
  await sql.query(`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`);
}

async function actor(sql: Sql, input: PlayInput) {
  const slug = input.slug.trim().toLowerCase();
  const name = cleanLine(input.name, 80);
  const key = input.memberKey.trim();
  if (!SLUG.test(slug)) return { error: "That wedding was not found." as const };
  if (!name) return { error: "Sign in on this phone before playing." as const };
  if (!KEY.test(key)) return { error: "Join this wedding before playing." as const };
  const rows = await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`;
  const row = rows[0];
  if (!row) return { error: "This wedding is not on the circle yet." as const };
  if (input.editKey.length >= 16 && row.edit_key === input.editKey) {
    await upsertMember(sql, slug, key, name, "host");
    return { slug, key, name };
  }
  const member = (await sql<{ role: string; name: string }>`select role, name from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (member && ["host", "cohost", "family", "guest"].includes(member.role)) {
    return { slug, key, name: cleanLine(member.name, 80) || name };
  }
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as { privacy?: { join?: string } } : row.payload as { privacy?: { join?: string } } | null;
  if (payload?.privacy?.join === "approve") return { error: "Join this wedding with its guest code before playing." as const };
  await upsertMember(sql, slug, key, name, "guest");
  return { slug, key, name };
}

async function upsertMember(sql: Sql, slug: string, key: string, name: string, role: string) {
  const existing = (await sql<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (existing) return;
  await sql`insert into circle_members (slug, member_key, email, name, role) values (${slug}, ${key}, ${""}, ${name}, ${role})`;
}

async function readRound(sql: Sql, id: string): Promise<Round | null> {
  const row = (await sql<{
    id: string; slug: string; starter_key: string; starter_name: string; prompt: string; phase: Round["phase"];
    submit_deadline: unknown; guess_deadline: unknown; score: number; scored: boolean;
  }>`select id, slug, starter_key, starter_name, prompt, phase, submit_deadline, guess_deadline, score, scored from who_said_rounds where id = ${id} limit 1`)[0];
  if (!row) return null;
  const statements = await sql<{
    id: string; author_key: string; author_name: string; public_token: string; body: string; sort_index: number;
  }>`select id, author_key, author_name, public_token, body, sort_index from who_said_statements where round_id = ${id}`;
  const guesses = await sql<{ statement_id: string; guess_key: string }>`select statement_id, guess_key from who_said_guesses where round_id = ${id}`;
  return {
    id: row.id,
    slug: row.slug,
    starterKey: row.starter_key,
    starterName: row.starter_name,
    prompt: row.prompt,
    phase: row.phase,
    submitDeadline: millis(row.submit_deadline),
    guessDeadline: millis(row.guess_deadline),
    score: Number(row.score ?? 0),
    scored: Boolean(row.scored),
    statements: statements.map((item) => ({
      id: item.id,
      authorKey: item.author_key,
      authorName: item.author_name,
      token: item.public_token,
      text: item.body,
      order: Number(item.sort_index ?? 0),
    })),
    guesses: guesses.map((item) => ({ statementId: item.statement_id, guessKey: item.guess_key })),
  };
}

async function activeRound(sql: Sql, slug: string) {
  const row = (await sql<{ id: string }>`select id from who_said_rounds where slug = ${slug} and phase in ('submit', 'guess') order by created_at desc limit 1`)[0];
  return row ? readRound(sql, row.id) : null;
}

async function savePhase(sql: Sql, before: Round, after: Round) {
  if (before.phase === after.phase && before.guessDeadline === after.guessDeadline && before.scored === after.scored) return after;
  if (after.phase === "guess" && before.phase === "submit") {
    const won = await sql<{ id: string }>`
      update who_said_rounds
      set phase = 'guess', guess_deadline = ${stamp(after.guessDeadline)}::timestamptz
      where id = ${after.id} and phase = 'submit'
      returning id
    `;
    if (won[0]) {
      for (const item of ordered(after)) {
        await sql`update who_said_statements set sort_index = ${item.order} where id = ${item.id}`;
      }
    }
    return (await readRound(sql, after.id)) ?? after;
  }
  if (after.phase === "empty" && before.phase === "submit") {
    await sql`
      update who_said_rounds
      set phase = 'empty', scored = true, score = 0
      where id = ${after.id} and phase = 'submit'
    `;
    return (await readRound(sql, after.id)) ?? after;
  }
  if (after.phase === "revealed" && before.phase === "guess") {
    const score = scoreOf(before.phase === "guess" ? before : after);
    await sql`
      update who_said_rounds
      set phase = 'revealed', scored = true, score = ${score}
      where id = ${after.id} and phase = 'guess' and scored = false
    `;
    return (await readRound(sql, after.id)) ?? after;
  }
  return (await readRound(sql, after.id)) ?? after;
}

async function settle(sql: Sql, round: Round, now: number) {
  const next = advance(round, now);
  if (next.phase === round.phase && next.guessDeadline === round.guessDeadline) return round;
  return savePhase(sql, round, next);
}

async function writeCards(sql: Sql, round: Round, now: number) {
  const cards = cardFor(round, now).map((card) => ({
    id: card.id,
    atLabel: "Now",
    at: new Date(now).toISOString(),
    author: "Seek",
    circle: "Circle",
    kind: "text",
    text: card.text,
    images: [],
    gameRev: card.gameRev,
    gameCard: card.gameCard,
  }));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = (await sql<{ payload: unknown }>`select payload from circles where slug = ${round.slug} limit 1`)[0];
    if (!row) return cards;
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as Record<string, unknown> : { ...(row.payload as Record<string, unknown>) };
    const posts = Array.isArray(payload.posts) ? [...payload.posts] as { id?: string; gameRev?: number }[] : [];
    let changed = false;
    for (const card of cards) {
      const index = posts.findIndex((item) => item?.id === card.id);
      if (index >= 0 && Number(posts[index]?.gameRev ?? 0) >= card.gameRev) continue;
      if (index >= 0) posts[index] = card;
      else posts.unshift(card);
      changed = true;
    }
    if (!changed) return cards;
    const rev = Number(payload.rev ?? 0);
    const next = { ...payload, posts, rev: rev + 1 };
    const saved = await sql<{ slug: string }>`
      update circles
      set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
      where slug = ${round.slug} and coalesce((payload->>'rev')::int, 0) = ${rev}
      returning slug
    `;
    if (saved[0]) return cards;
  }
  return cards;
}

function pack(round: Round, key: string, now: number, cards: ReturnType<typeof cardFor>) {
  const view = toPublic(round, key, now);
  return {
    ok: true as const,
    round: view,
    cards: cards.map((card) => ({
      id: card.id,
      atLabel: "Now",
      at: new Date(now).toISOString(),
      author: "Seek",
      circle: "Circle",
      kind: "text" as const,
      text: card.text,
      images: [] as string[],
      gameRev: card.gameRev,
      gameCard: card.gameCard,
    })),
  };
}

async function finish(sql: Sql, round: Round, key: string, now: number) {
  const settled = await settle(sql, round, now);
  const fresh = (await readRound(sql, settled.id)) ?? settled;
  const cards = await writeCards(sql, fresh, now);
  return { ...pack(fresh, key, now, cardFor(fresh, now)), cards };
}

export async function startRoundOn(sql: Sql, input: PlayInput, now = Date.now()) {
  await ensureWhoSaid(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const prompt = cleanLine(input.prompt, 80);
  if (prompt.length < 2) return { ok: false as const, error: "Write a short question first." };
  if (limited(`${who.slug}:${who.key}:start`)) return { ok: false as const, error: "Wait a moment, then try again." };
  const current = await activeRound(sql, who.slug);
  if (current) return finish(sql, current, who.key, now);
  const id = nid("ws");
  const submitDeadline = now + SUBMIT_MS;
  const guessDeadline = submitDeadline + GUESS_MS;
  try {
    const inserted = await sql<{ id: string }>`
      insert into who_said_rounds (id, slug, starter_key, starter_name, prompt, phase, submit_deadline, guess_deadline, score, scored)
      values (${id}, ${who.slug}, ${who.key}, ${who.name}, ${prompt}, ${"submit"}, ${stamp(submitDeadline)}::timestamptz, ${stamp(guessDeadline)}::timestamptz, ${0}, ${false})
      returning id
    `;
    if (!inserted[0]) {
      const live = await activeRound(sql, who.slug);
      if (live) return finish(sql, live, who.key, now);
      return { ok: false as const, error: "A round is already open." };
    }
  } catch {
    const live = await activeRound(sql, who.slug);
    if (live) return finish(sql, live, who.key, now);
    return { ok: false as const, error: "A round is already open." };
  }
  const created = await readRound(sql, id);
  if (!created) return { ok: false as const, error: "The round could not be opened." };
  return finish(sql, created, who.key, now);
}

export async function submitLineOn(sql: Sql, input: PlayInput, now = Date.now()) {
  await ensureWhoSaid(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  if (limited(`${who.slug}:${who.key}:line`)) return { ok: false as const, error: "Wait a moment, then try again." };
  const round = input.roundId ? await readRound(sql, input.roundId) : await activeRound(sql, who.slug);
  if (!round || round.slug !== who.slug) return { ok: false as const, error: "There is no open round." };
  const settled = await settle(sql, round, now);
  const statement: Statement = {
    id: nid("ln"),
    authorKey: who.key,
    authorName: who.name,
    token: randomBytes(6).toString("hex"),
    text: input.text ?? "",
    order: settled.statements.length,
  };
  const decision = addStatement(settled, statement, now);
  if (decision.error) return { ok: false as const, error: decision.error, round: toPublic(settled, who.key, now) };
  try {
    await sql`
      insert into who_said_statements (id, round_id, author_key, author_name, public_token, body, sort_index)
      values (${statement.id}, ${settled.id}, ${who.key}, ${who.name}, ${statement.token}, ${cleanLine(input.text, 200)}, ${settled.statements.length})
    `;
  } catch {
    return { ok: false as const, error: "You already sent a line for this round.", round: toPublic(settled, who.key, now) };
  }
  const fresh = (await readRound(sql, settled.id)) ?? decision.round;
  return finish(sql, fresh, who.key, now);
}

export async function guessOn(sql: Sql, input: PlayInput, now = Date.now()) {
  await ensureWhoSaid(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const round = input.roundId ? await readRound(sql, input.roundId) : await activeRound(sql, who.slug);
  if (!round || round.slug !== who.slug) return { ok: false as const, error: "There is no open round." };
  if (limited(`${who.slug}:${who.key}:guess`)) return { ok: false as const, error: "Wait a moment, then try again." };
  const settled = await settle(sql, round, now);
  const decision = assignGuess(settled, input.statementId ?? "", settled.statements.find((item) => item.token === input.token)?.authorKey ?? "", who.key, now);
  if (decision.error) return { ok: false as const, error: decision.error, round: toPublic(settled, who.key, now) };
  await sql`delete from who_said_guesses where round_id = ${settled.id}`;
  for (const guess of decision.round.guesses) {
    await sql`
      insert into who_said_guesses (round_id, statement_id, guess_key)
      values (${settled.id}, ${guess.statementId}, ${guess.guessKey})
    `;
  }
  const fresh = (await readRound(sql, settled.id)) ?? decision.round;
  return finish(sql, fresh, who.key, now);
}

export async function lockRoundOn(sql: Sql, input: PlayInput, now = Date.now()) {
  await ensureWhoSaid(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const round = input.roundId ? await readRound(sql, input.roundId) : await activeRound(sql, who.slug);
  if (!round || round.slug !== who.slug) return { ok: false as const, error: "There is no open round." };
  const settled = await settle(sql, round, now);
  if (settled.phase === "revealed" || settled.phase === "empty") return finish(sql, settled, who.key, now);
  if (!canLock(settled) || who.key !== settled.starterKey) {
    const decision = lockEarly(settled, who.key);
    return { ok: false as const, error: decision.error ?? "Every line needs a guess before it can lock.", round: toPublic(settled, who.key, now) };
  }
  const score = scoreOf(settled);
  const won = await sql<{ id: string; score: number }>`
    update who_said_rounds
    set phase = 'revealed', scored = true, score = ${score}
    where id = ${settled.id} and phase = 'guess' and scored = false
    returning id, score
  `;
  const fresh = (await readRound(sql, settled.id)) ?? settled;
  if (!won[0] && fresh.phase !== "revealed") {
    return { ok: false as const, error: "This round could not be locked.", round: toPublic(fresh, who.key, now) };
  }
  return finish(sql, fresh, who.key, now);
}

export async function syncRoundOn(sql: Sql, input: PlayInput, now = Date.now()) {
  await ensureWhoSaid(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const current = input.roundId ? await readRound(sql, input.roundId) : await activeRound(sql, who.slug);
  if (input.roundId && (!current || current.slug !== who.slug)) return { ok: false as const, error: "There is no open round." };
  if (!current || current.slug !== who.slug) return { ok: true as const, round: null, cards: [] };
  return finish(sql, current, who.key, now);
}
