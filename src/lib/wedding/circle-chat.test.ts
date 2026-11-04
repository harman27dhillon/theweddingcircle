import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { presentPoll, voteAllowed, type PollInput } from "./poll.ts";
import { whisperFor, type WhisperRow } from "./whisper.ts";
import { deleteWhisperOn, listWhispersOn, revealWhisperOn, sendWhisperOn } from "./whisper.db.ts";
import { createPollOn, listPollsOn, votePollOn } from "./poll.db.ts";

const row = (patch: Partial<WhisperRow> = {}): WhisperRow => ({
  id: "wh_1",
  slug: "asha-rohan",
  parentPostId: "post1",
  parentExcerpt: "Hotel",
  senderKey: "asha-key1",
  senderName: "Asha",
  recipientKey: "aman-key1",
  recipientName: "Aman",
  body: "The side door",
  createdAt: 1,
  firstRevealedAt: null,
  expiresAt: null,
  deletedAt: null,
  ...patch,
});

test("a whisper is invisible to everyone except the two people in it", () => {
  const secret = row();
  assert.equal(whisperFor(secret, "meera-key", 10), null);
  assert.equal(whisperFor(secret, "host-key9", 10), null);
  const sender = whisperFor(secret, "asha-key1", 10);
  assert.equal(sender?.body, "The side door");
  assert.equal(sender?.unopened, true);
  const waiting = whisperFor(secret, "aman-key1", 10);
  assert.equal(waiting?.collapsed, true);
  assert.equal(waiting?.body, "");
  assert.equal(waiting?.parentExcerpt, "");
  const open = whisperFor(row({ firstRevealedAt: 100, expiresAt: 160 }), "aman-key1", 120);
  assert.equal(open?.body, "The side door");
  assert.equal(whisperFor(row({ firstRevealedAt: 100, expiresAt: 160 }), "aman-key1", 160), null);
  assert.equal(whisperFor(row({ deletedAt: 50 }), "asha-key1", 60), null);
});

test("hidden poll totals stay hidden, and anonymous views name nobody", () => {
  const poll: PollInput = {
    id: "poll_1",
    postId: "post",
    question: "Which gate?",
    multiple: false,
    anonymous: true,
    changeVotes: true,
    addOptions: false,
    results: "after_vote",
    expiresAt: null,
    createdAt: 1,
    options: [{ id: "a", label: "North" }, { id: "b", label: "South" }],
    votes: [{ optionId: "a", memberKey: "aman-key1" }],
  };
  const hidden = presentPoll(poll, "asha-key1", 10);
  assert.equal(hidden.countsVisible, false);
  assert.equal(hidden.options.every((option) => option.count == null), true);
  assert.equal(JSON.stringify(hidden).includes("aman-key1"), false);
  const seen = presentPoll(poll, "aman-key1", 10);
  assert.equal(seen.options[0]?.count, 1);
  assert.equal(JSON.stringify(seen).includes("aman-key1"), false);
  const closed = presentPoll({ ...poll, results: "after_close", expiresAt: 5 }, "asha-key1", 10);
  assert.equal(closed.closed, true);
  assert.equal(closed.options[0]?.leading, true);
  assert.equal(voteAllowed(poll, "asha-key1", ["a", "b"], 10), "This poll takes one choice.");
});

function sqlOf(db: PGlite) {
  const run = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows as Record<string, unknown>[];
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    const params: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) {
        params.push(values[index]);
        text += `$${params.length}`;
      }
    });
    return run(text, params);
  }) as {
    <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
    query<T>(text: string, params?: unknown[]): Promise<T[]>;
  };
  tag.query = run as typeof tag.query;
  return tag;
}

test("whispers stay private, reveal once, and then expire for both people", async () => {
  const db = new PGlite();
  await db.exec(`create table circles (slug text primary key, payload jsonb not null, edit_key text not null, updated_at timestamptz not null default now())`);
  await db.exec(`create table circle_members (slug text not null, member_key text not null, email text not null default '', name text not null default '', role text not null, primary key (slug, member_key))`);
  const payload = {
    slug: "asha-rohan",
    posts: [{ id: "post1", author: "Aman", authorId: "email:aman@example.com", text: "The hotel is ready" }],
    guestProfiles: { "aman-key1": { displayName: "Aman", accountId: "email:aman@example.com" } },
  };
  await db.query(`insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`, ["asha-rohan", JSON.stringify(payload), "edit-key-host-0001"]);
  await db.query(`insert into circle_members (slug, member_key, name, role) values ('asha-rohan', 'aman-key1', 'Aman', 'guest'), ('asha-rohan', 'meera-key', 'Meera', 'guest')`);
  const sql = sqlOf(db);
  const asha = { slug: "asha-rohan", memberKey: "asha-key1", editKey: "edit-key-host-0001", name: "Asha" };
  const sent = await sendWhisperOn(sql, { ...asha, parentPostId: "post1", recipientKey: "aman-key1", body: "Use the side door" });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const meera = await listWhispersOn(sql, { slug: "asha-rohan", memberKey: "meera-key", editKey: "", name: "Meera" });
  assert.equal(meera.ok && meera.whispers.length, 0);
  const peek = await revealWhisperOn(sql, { ...asha, whisperId: sent.whisper.id });
  assert.equal(peek.ok && peek.whisper.unopened, true);
  const aman = { slug: "asha-rohan", memberKey: "aman-key1", editKey: "", name: "Aman" };
  const first = await revealWhisperOn(sql, { ...aman, whisperId: sent.whisper.id });
  const second = await revealWhisperOn(sql, { ...aman, whisperId: sent.whisper.id });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.whisper.expiresAt, second.whisper.expiresAt);
  const span = (await db.query(`select extract(epoch from (expires_at - first_revealed_at)) as span from whispers where id = $1`, [sent.whisper.id])).rows[0] as { span: number };
  assert.ok(Number(span.span) >= 59 && Number(span.span) <= 61);
  await db.query(`update whispers set expires_at = now() - interval '1 second' where id = $1`, [sent.whisper.id]);
  const gone = await listWhispersOn(sql, aman);
  assert.equal(gone.ok && gone.whispers.length, 0);
  const blank = (await db.query(`select body from whispers where id = $1`, [sent.whisper.id])).rows[0] as { body: string };
  assert.equal(blank.body, "");
  const early = await sendWhisperOn(sql, { ...asha, parentPostId: "post1", recipientKey: "aman-key1", body: "One more" });
  assert.equal(early.ok, true);
  if (!early.ok) return;
  const removed = await deleteWhisperOn(sql, { ...asha, whisperId: early.whisper.id });
  assert.equal(removed.ok, true);
  const after = await listWhispersOn(sql, asha);
  assert.equal(after.ok && after.whispers.some((item) => item.id === early.whisper.id), false);
});

test("poll votes are checked on the server and anonymous results omit people", async () => {
  const db = new PGlite();
  await db.exec(`create table circles (slug text primary key, payload jsonb not null, edit_key text not null, updated_at timestamptz not null default now())`);
  await db.exec(`create table circle_members (slug text not null, member_key text not null, email text not null default '', name text not null default '', role text not null, primary key (slug, member_key))`);
  await db.query(`insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`, ["asha-rohan", JSON.stringify({ slug: "asha-rohan", posts: [], rev: 0 }), "edit-key-host-0001"]);
  await db.query(`insert into circle_members (slug, member_key, name, role) values ('asha-rohan', 'aman-key1', 'Aman', 'guest')`);
  const sql = sqlOf(db);
  const asha = { slug: "asha-rohan", memberKey: "asha-key1", editKey: "edit-key-host-0001", name: "Asha" };
  const created = await createPollOn(sql, { ...asha, question: "Which gate?", options: ["North", "South"], multiple: false, anonymous: true, changeVotes: false, addOptions: false, results: "after_vote", expiresAt: "" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.poll.countsVisible, false);
  const outsider = await listPollsOn(sql, { slug: "asha-rohan", memberKey: "meera-key", editKey: "", name: "Meera" });
  assert.equal(outsider.ok, false);
  const option = created.poll.options[0]!.id;
  const voted = await votePollOn(sql, { ...asha, pollId: created.poll.id, optionIds: [option] });
  assert.equal(voted.ok, true);
  if (!voted.ok) return;
  assert.equal(voted.poll.options.find((item) => item.id === option)?.count, 1);
  assert.equal(JSON.stringify(voted.poll).includes("asha-key1"), false);
  const changed = await votePollOn(sql, { ...asha, pollId: created.poll.id, optionIds: [created.poll.options[1]!.id] });
  assert.equal(changed.ok, false);
  const posted = (await db.query(`select payload->'posts'->0->>'pollId' as poll_id from circles where slug = 'asha-rohan'`)).rows[0] as { poll_id: string };
  assert.equal(posted.poll_id, created.poll.id);
});
