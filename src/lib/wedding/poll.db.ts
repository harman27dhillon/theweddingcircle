import { randomBytes } from "node:crypto";
import { presentPoll, voteAllowed, type PollInput, type PollResults, type PollView } from "./poll";
import type { FeedPost } from "./types";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query?<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const SLUG = /^[a-z0-9-]{3,80}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

export async function ensurePolls(sql: Sql) {
  if (!sql.query) return;
  await sql.query(`create table if not exists chat_polls (
    id text primary key, slug text not null, post_id text not null, author_key text not null, author_name text not null,
    question text not null, multiple boolean not null default false, anonymous boolean not null default false,
    change_votes boolean not null default true, add_options boolean not null default false, results text not null default 'immediate',
    expires_at timestamptz, created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists chat_poll_options (
    id text primary key, poll_id text not null, label text not null, sort_index integer not null default 0
  )`);
  await sql.query(`create table if not exists chat_poll_votes (
    poll_id text not null, option_id text not null, member_key text not null, created_at timestamptz not null default now(),
    primary key (poll_id, option_id, member_key)
  )`);
}

function nid(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

async function actor(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string }) {
  const slug = input.slug.trim().toLowerCase();
  const key = input.memberKey.trim();
  const name = input.name.replace(/[<>]/g, "").trim().slice(0, 80);
  if (!SLUG.test(slug) || !KEY.test(key) || !name) return { error: "Join this wedding before using a poll." };
  const row = (await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`)[0];
  if (!row) return { error: "This wedding is not on the circle yet." };
  if (input.editKey.length >= 16 && row.edit_key === input.editKey) return { slug, memberKey: key, name, role: "host" as const };
  const member = (await sql<{ role: string; name: string }>`select role, name from circle_members where slug = ${slug} and member_key = ${key} limit 1`)[0];
  if (!member) return { error: "Join this wedding before using a poll." };
  return { slug, memberKey: key, name: member.name || name, role: member.role };
}

function resultsOf(value: string): PollResults {
  return value === "after_vote" || value === "after_close" ? value : "immediate";
}

async function loadPoll(sql: Sql, slug: string, id: string, now: number): Promise<PollInput | null> {
  const poll = (await sql<Record<string, unknown>>`select * from chat_polls where id = ${id} and slug = ${slug} limit 1`)[0];
  if (!poll) return null;
  const options = await sql<{ id: string; label: string }>`select id, label from chat_poll_options where poll_id = ${id} order by sort_index asc`;
  const votes = await sql<{ option_id: string; member_key: string }>`select option_id, member_key from chat_poll_votes where poll_id = ${id}`;
  return {
    id: String(poll.id),
    postId: String(poll.post_id),
    question: String(poll.question),
    multiple: Boolean(poll.multiple),
    anonymous: Boolean(poll.anonymous),
    changeVotes: Boolean(poll.change_votes),
    addOptions: Boolean(poll.add_options),
    results: resultsOf(String(poll.results)),
    expiresAt: poll.expires_at ? new Date(poll.expires_at as string).getTime() : null,
    createdAt: new Date(poll.created_at as string).getTime(),
    options,
    votes: votes.map((vote) => ({ optionId: vote.option_id, memberKey: vote.member_key })),
  };
}

async function savePost(sql: Sql, slug: string, post: FeedPost) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = (await sql<{ payload: unknown; rev: number }>`select payload, coalesce((payload->>'rev')::int, 0) as rev from circles where slug = ${slug} limit 1`)[0];
    if (!row) return false;
    const wedding = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    if (!wedding || typeof wedding !== "object") return false;
    const posts = Array.isArray(wedding.posts) ? wedding.posts : [];
    if (posts.some((item: { id?: string }) => item.id === post.id)) return true;
    const next = { ...wedding, rev: Number(row.rev ?? 0) + 1, posts: [post, ...posts] };
    const saved = await sql<{ slug: string }>`
      update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
      where slug = ${slug} and coalesce((payload->>'rev')::int, 0) = ${Number(row.rev ?? 0)}
      returning slug
    `;
    if (saved[0]) return true;
  }
  return false;
}

export async function listPollsOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string }, now = Date.now()) {
  await ensurePolls(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const rows = await sql<{ id: string }>`select id from chat_polls where slug = ${who.slug} order by created_at desc`;
  const polls: PollView[] = [];
  for (const row of rows) {
    const poll = await loadPoll(sql, who.slug, row.id, now);
    if (poll) polls.push(presentPoll(poll, who.memberKey, now));
  }
  return { ok: true as const, polls, serverNow: now };
}

export async function createPollOn(sql: Sql, input: {
  slug: string; memberKey: string; editKey: string; name: string;
  question: string; options: string[]; multiple: boolean; anonymous: boolean; changeVotes: boolean; addOptions: boolean;
  results: string; expiresAt: string;
}, now = Date.now()) {
  await ensurePolls(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const question = input.question.replace(/\s+/g, " ").trim().slice(0, 140);
  const options = input.options.map((item) => item.replace(/\s+/g, " ").trim().slice(0, 80)).filter(Boolean);
  if (!question) return { ok: false as const, error: "Write a poll question." };
  if (options.length < 2 || options.length > 12) return { ok: false as const, error: "Add between 2 and 12 answers." };
  if (new Set(options.map((item) => item.toLowerCase())).size !== options.length) return { ok: false as const, error: "Each answer needs to be different." };
  const results = resultsOf(input.results);
  let expires: number | null = null;
  if (input.expiresAt) {
    expires = Date.parse(input.expiresAt);
    if (Number.isNaN(expires) || expires <= now || expires > now + 30 * 86_400_000) return { ok: false as const, error: "Choose a poll end time in the future." };
  }
  const id = nid("poll");
  const postId = nid("post");
  await sql`
    insert into chat_polls (id, slug, post_id, author_key, author_name, question, multiple, anonymous, change_votes, add_options, results, expires_at)
    values (${id}, ${who.slug}, ${postId}, ${who.memberKey}, ${who.name}, ${question}, ${input.multiple}, ${input.anonymous}, ${input.changeVotes}, ${input.addOptions}, ${results}, ${expires ? new Date(expires).toISOString() : null})
  `;
  for (let index = 0; index < options.length; index += 1) {
    await sql`insert into chat_poll_options (id, poll_id, label, sort_index) values (${nid("opt")}, ${id}, ${options[index]}, ${index})`;
  }
  const post: FeedPost = {
    id: postId,
    at: new Date(now).toISOString(),
    atLabel: "Now",
    author: who.name,
    circle: "Guests",
    kind: "text",
    text: question,
    images: [],
    pollId: id,
    reactions: [],
    comments: [],
  };
  const saved = await savePost(sql, who.slug, post);
  if (!saved) return { ok: false as const, error: "The poll could not be posted to the chat." };
  const poll = await loadPoll(sql, who.slug, id, now);
  return poll ? { ok: true as const, poll: presentPoll(poll, who.memberKey, now), post, serverNow: now } : { ok: false as const, error: "The poll could not be posted." };
}

export async function votePollOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; pollId: string; optionIds: string[] }, now = Date.now()) {
  await ensurePolls(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const poll = await loadPoll(sql, who.slug, input.pollId.slice(0, 40), now);
  if (!poll) return { ok: false as const, error: "That poll is not in this wedding." };
  const optionIds = [...new Set(input.optionIds.map((id) => id.slice(0, 40)).filter(Boolean))];
  const reason = voteAllowed(poll, who.memberKey, optionIds, now);
  if (reason) return { ok: false as const, error: reason };
  if (poll.changeVotes) await sql`delete from chat_poll_votes where poll_id = ${poll.id} and member_key = ${who.memberKey}`;
  for (const optionId of optionIds) {
    await sql`
      insert into chat_poll_votes (poll_id, option_id, member_key)
      values (${poll.id}, ${optionId}, ${who.memberKey})
      on conflict (poll_id, option_id, member_key) do nothing
    `;
  }
  const next = await loadPoll(sql, who.slug, poll.id, now);
  return next ? { ok: true as const, poll: presentPoll(next, who.memberKey, now), serverNow: now } : { ok: false as const, error: "That vote was not saved." };
}

export async function addPollOptionOn(sql: Sql, input: { slug: string; memberKey: string; editKey: string; name: string; pollId: string; label: string }, now = Date.now()) {
  await ensurePolls(sql);
  const who = await actor(sql, input);
  if ("error" in who) return { ok: false as const, error: who.error };
  const poll = await loadPoll(sql, who.slug, input.pollId.slice(0, 40), now);
  if (!poll) return { ok: false as const, error: "That poll is not in this wedding." };
  if (!poll.addOptions || (poll.expiresAt != null && poll.expiresAt <= now)) return { ok: false as const, error: "This poll is not taking new answers." };
  const label = input.label.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!label) return { ok: false as const, error: "Write an answer first." };
  if (poll.options.length >= 12) return { ok: false as const, error: "This poll already has 12 answers." };
  if (poll.options.some((option) => option.label.toLowerCase() === label.toLowerCase())) return { ok: false as const, error: "That answer is already there." };
  await sql`insert into chat_poll_options (id, poll_id, label, sort_index) values (${nid("opt")}, ${poll.id}, ${label}, ${poll.options.length})`;
  const next = await loadPoll(sql, who.slug, poll.id, now);
  return next ? { ok: true as const, poll: presentPoll(next, who.memberKey, now), serverNow: now } : { ok: false as const, error: "That answer was not added." };
}
