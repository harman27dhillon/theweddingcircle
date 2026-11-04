import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { decideSeek } from "./seek/engine.ts";
import { parseSeek } from "./seek.ts";
import { askSeekOn, shareSeekOn } from "./seek.db.ts";
import type { Wedding } from "./types.ts";

test("Seek only treats an @seek mention as a command", () => {
  assert.equal(parseSeek("@seek start who said it"), "start");
  assert.equal(parseSeek("  @Seek   start   who said it. "), "start");
  assert.equal(parseSeek("please @seek start who said it"), "start");
  assert.equal(parseSeek("@seek"), "help");
  assert.equal(parseSeek("@seek dance"), "ask");
  assert.equal(parseSeek("see you at the venue"), null);
});

function circle(tasks: Wedding["tasks"], posts: Wedding["posts"] = []): Pick<Wedding, "posts" | "guests" | "functions" | "tasks" | "bride" | "groom"> {
  return { bride: "Asha", groom: "Rohan", guests: [], functions: [], tasks, posts };
}

const viewer = { name: "Asha", role: "guest" as const };

test("task questions match English, Hindi, Punjabi, and Roman Punjabi without guessing", () => {
  const tasks = [{ id: "t1", title: "Decorations", owner: "Aman", when: "Friday", done: true, category: "Ceremony arrangements" }];
  const wedding = circle(tasks);
  const phrases = [
    "@seek Did Aman finish decorations?",
    "@seek Aman ne decoration ka kaam kar diya?",
    "@seek ਅਮਨ ਨੇ ਸਜਾਵਟ ਦਾ ਕੰਮ ਕਰ ਦਿੱਤਾ?",
    "@seek Aman ne decoration da kamm krditta?",
    "@seek अमन ने डेकोरेशन का काम पूरा किया?",
  ];
  for (const phrase of phrases) {
    const decision = decideSeek({ text: phrase, now: 1_700_000_000_000, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false });
    assert.equal(decision.intent, "CHECK_TASK_STATUS", phrase);
    assert.match(decision.reply, /Yes|ਹਾਂ|हाँ|marked|ਮਾਰਕ|मार्क/);
    assert.doesNotMatch(decision.reply, /verified complete/i);
  }
  const missing = decideSeek({ text: "@seek Did Kabir finish the cake?", now: 1, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false });
  assert.match(missing.reply, /could not find|ਨਹੀਂ|नहीं/);
});

test("search stays inside authorized messages and does not invent a decision", () => {
  const posts = [
    { id: "a", at: "2026-10-30T10:00:00.000Z", atLabel: "Now", author: "Rahul", circle: "Guests", kind: "text" as const, text: "Departure at 6.", images: [] },
    { id: "b", at: "2026-10-30T11:00:00.000Z", atLabel: "Now", author: "Meera", circle: "Guests", kind: "text" as const, text: "Departure at 8.", images: [] },
    { id: "c", at: "2026-10-30T12:00:00.000Z", atLabel: "Now", author: "Oni", circle: "Guests", kind: "photos" as const, text: "Mehndi photo", images: ["idb:1"], removed: true },
    { id: "d", at: "2026-10-23T12:00:00.000Z", atLabel: "Now", author: "Rahul", circle: "Guests", kind: "photos" as const, text: "Friday mehndi", images: ["idb:2"] },
  ];
  const wedding = circle([], posts);
  const now = Date.parse("2026-10-30T18:00:00.000Z");
  const conflict = decideSeek({ text: "@seek what did we finally decide about departure time?", now, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false });
  assert.match(conflict.reply, /do not say the same thing/);
  assert.equal(conflict.sources.some((item) => item.id === "c"), false);
  const photos = decideSeek({ text: "@seek show photos from Friday", now, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false });
  assert.equal(photos.intent, "SEARCH_MEDIA");
  assert.equal(photos.sources.some((item) => item.id === "d"), true);
  assert.match(photos.reply, /cannot see what is inside a photo/);
  const follow = decideSeek({ text: "@seek only those Rahul posted", now: now + 1000, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false, state: photos.nextState });
  assert.equal(follow.sources.every((item) => item.author === "Rahul"), true);
  const expired = decideSeek({ text: "@seek only those Rahul posted", now: now + 200_000, explicit: true, hasPhoto: false, wedding, viewer, mode: "QUIET", allowPhoto: false, muted: false, state: photos.nextState });
  assert.equal(expired.intent, "UNKNOWN");
});

test("quiet mode stays silent and compliments never describe a photo", () => {
  const wedding = circle([]);
  const quiet = decideSeek({ text: "How am I looking?", now: 1, explicit: false, hasPhoto: true, wedding, viewer, mode: "QUIET", allowPhoto: true, muted: false });
  assert.equal(quiet.reply, "");
  const opted = decideSeek({ text: "kiddan lag reha", now: 1, explicit: false, hasPhoto: true, wedding, viewer, mode: "SOCIAL", allowPhoto: true, muted: false, recentTemplateIds: ["look-1"] });
  assert.equal(opted.social, true);
  assert.notEqual(opted.templateId, "look-1");
  assert.doesNotMatch(opted.reply, /red|blue|dress|lehenga|suit/i);
  const muted = decideSeek({ text: "How am I looking?", now: 1, explicit: false, hasPhoto: true, wedding, viewer, mode: "PARTY", allowPhoto: true, muted: true });
  assert.equal(muted.reply, "");
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

test("Seek replies are private, idempotent, and stay in one wedding", async () => {
  const db = new PGlite();
  await db.exec(`create table circles (
    slug text primary key,
    payload jsonb not null,
    edit_key text not null,
    updated_at timestamptz not null default now()
  )`);
  await db.exec(`create table circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`);
  const payload = { slug: "asha-rohan", bride: "Asha", groom: "Rohan", posts: [{ id: "p1", author: "Rahul", text: "Hotel is on Mall Road.", images: [], kind: "text", circle: "Guests", atLabel: "Now" }], tasks: [], guests: [], functions: [], rev: 0 };
  await db.query(`insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`, ["asha-rohan", JSON.stringify(payload), "edit-key-host-0001"]);
  await db.query(`insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`, ["other-wedding", JSON.stringify({ ...payload, slug: "other-wedding" }), "edit-key-host-0001"]);
  const sql = sqlOf(db);
  const host = { slug: "asha-rohan", memberKey: "hostkey01", editKey: "edit-key-host-0001", name: "Asha" };
  const first = await askSeekOn(sql, { ...host, text: "@seek where did Rahul share the hotel address?", eventId: "event-hotel-1" });
  assert.equal(first.ok, true);
  if (!first.ok || first.kind !== "private") return;
  assert.match(first.answer, /Mall Road/);
  const again = await askSeekOn(sql, { ...host, text: "@seek where did Rahul share the hotel address?", eventId: "event-hotel-1" });
  assert.equal(again.ok, true);
  if (!again.ok || again.kind !== "private") return;
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  const leaked = await shareSeekOn(sql, { slug: "other-wedding", memberKey: "hostkey01", editKey: "edit-key-host-0001", name: "Asha", turnId: first.id });
  assert.equal(leaked.ok, false);
  const shared = await shareSeekOn(sql, { ...host, turnId: first.id });
  assert.equal(shared.ok, true);
  if (!shared.ok) return;
  assert.equal(shared.post.companion, true);
  assert.equal(shared.post.author, "Seek");
  assert.doesNotMatch(shared.post.text, /where did Rahul/i);
});
