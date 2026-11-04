import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canLock, cleanLine, publicHasSecrets, resultOf, scoreOf, shuffle, toPublic, type Round, type Statement } from "./who-said.ts";
import { guessOn, lockRoundOn, startRoundOn, submitLineOn, syncRoundOn } from "./who-said.db.ts";

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

async function circle(db: PGlite, slug: string) {
  await db.query(
    `insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)`,
    [slug, JSON.stringify({ slug, bride: "Asha", groom: "Rohan", posts: [], rev: 0, privacy: { join: "open" } }), "edit-key-host-0001"],
  );
}

function person(slug: string, key: string, name: string) {
  return { slug, memberKey: key, editKey: "", name };
}

test("lines are cleaned and shuffle order is stable", () => {
  assert.equal(cleanLine("  <hi>\n there  ", 20), "hi there");
  const items = ["a", "b", "c", "d", "e"];
  assert.deepEqual(shuffle(items, "round-1"), shuffle(items, "round-1"));
  assert.notDeepEqual(shuffle(items, "round-1"), items);
});

test("who said it rounds stay anonymous until lock, then score once", async () => {
  const db = new PGlite();
  await db.exec(`create table circles (
    slug text primary key,
    payload jsonb not null,
    edit_key text not null,
    updated_at timestamptz not null default now()
  )`);
  const sql = sqlOf(db);
  await circle(db, "asha-rohan");
  await circle(db, "meera-kabir");
  const start = Date.parse("2026-10-29T12:00:00.000Z");
  const host = person("asha-rohan", "hostkey01", "Host");
  const guest = person("asha-rohan", "guestkey1", "Guest");
  const other = person("asha-rohan", "otherkey1", "Other");
  const outsider = person("asha-rohan", "watchkey1", "Watcher");

  const opened = await startRoundOn(sql, { ...host, prompt: "Share a funny memory of the groom." }, start);
  assert.equal(opened.ok, true);
  if (!opened.ok || !opened.round) return;
  assert.equal(opened.round.phase, "submit");
  assert.equal(opened.round.youStarted, true);

  const again = await startRoundOn(sql, { ...guest, prompt: "Another question now" }, start + 1000);
  assert.equal(again.ok, true);
  if (!again.ok || !again.round) return;
  assert.equal(again.round.id, opened.round.id);

  const first = await submitLineOn(sql, { ...guest, roundId: opened.round.id, text: "He dances in the kitchen." }, start + 2000);
  assert.equal(first.ok, true);
  const second = await submitLineOn(sql, { ...guest, roundId: opened.round.id, text: "A second line" }, start + 3000);
  assert.equal(second.ok, false);
  const hostLine = await submitLineOn(sql, { ...host, roundId: opened.round.id, text: "He loses every umbrella." }, start + 4000);
  assert.equal(hostLine.ok, false);
  const pal = await submitLineOn(sql, { ...other, roundId: opened.round.id, text: "He loses every umbrella." }, start + 4500);
  assert.equal(pal.ok, true);
  const late = await submitLineOn(sql, { ...person("asha-rohan", "latekey01", "Late"), roundId: opened.round.id, text: "Too late" }, start + 61_000);
  assert.equal(late.ok, false);

  const guessing = await syncRoundOn(sql, { ...outsider, roundId: opened.round.id }, start + 61_000);
  assert.equal(guessing.ok, true);
  if (!guessing.ok || !guessing.round) return;
  assert.equal(guessing.round.phase, "guess");
  assert.equal(guessing.round.lines.length, 2);
  assert.equal(guessing.round.authors.length, 0);
  for (const line of guessing.round.lines) {
    assert.equal(line.authorName, undefined);
    assert.equal(line.result, undefined);
  }
  assert.equal(publicHasSecrets(guessing.round), false);
  const card = guessing.cards.find((item) => item.id.endsWith("-card"));
  assert.ok(card);
  assert.equal(guessing.cards.filter((item) => String(item.id).endsWith("-card")).length, 1);
  assert.match(card?.text ?? "", /He dances in the kitchen/);
  assert.match(card?.text ?? "", /He loses every umbrella/);
  assert.doesNotMatch(card?.text ?? "", /Guest|Host/);

  const starterView = await syncRoundOn(sql, { ...host, roundId: opened.round.id }, start + 62_000);
  assert.equal(starterView.ok, true);
  if (!starterView.ok || !starterView.round) return;
  assert.equal(starterView.round.authors.length, 2);
  assert.ok(starterView.round.authors.every((item) => item.name === "Guest" || item.name === "Other"));
  assert.equal(starterView.round.authors.some((item) => item.name === "Watcher"), false);

  const peek = await guessOn(sql, {
    ...guest,
    roundId: opened.round.id,
    statementId: starterView.round.lines[0]?.id,
    token: starterView.round.authors[0]?.token,
  }, start + 63_000);
  assert.equal(peek.ok, false);

  const early = await lockRoundOn(sql, { ...host, roundId: opened.round.id }, start + 64_000);
  assert.equal(early.ok, false);

  const tokenFor = (name: string) => starterView.round?.authors.find((item) => item.name === name)?.token ?? "";
  const lines = starterView.round.lines;
  const wrong = await guessOn(sql, { ...host, roundId: opened.round.id, statementId: lines[0]?.id, token: tokenFor(lines[0]?.text.includes("umbrella") ? "Guest" : "Other") }, start + 65_000);
  assert.equal(wrong.ok, true);
  const partial = await lockRoundOn(sql, { ...host, roundId: opened.round.id }, start + 66_000);
  assert.equal(partial.ok, false);

  const rightName = lines[1]?.text.includes("umbrella") ? "Other" : "Guest";
  const full = await guessOn(sql, { ...host, roundId: opened.round.id, statementId: lines[1]?.id, token: tokenFor(rightName) }, start + 67_000);
  assert.equal(full.ok, true);
  if (!full.ok || !full.round) return;
  assert.equal(full.round.picks.length, 2);
  const locked = await lockRoundOn(sql, { ...host, roundId: opened.round.id }, start + 68_000);
  assert.equal(locked.ok, true);
  if (!locked.ok || !locked.round) return;
  assert.equal(locked.round.phase, "revealed");
  assert.equal(locked.round.score, 1);
  assert.equal(locked.round.scoreText, "1 out of 2 correct");
  const marks = locked.round.lines.map((line) => line.result).sort();
  assert.deepEqual(marks, ["correct", "wrong"]);
  const againLock = await lockRoundOn(sql, { ...host, roundId: opened.round.id }, start + 69_000);
  assert.equal(againLock.ok, true);
  if (!againLock.ok || !againLock.round) return;
  assert.equal(againLock.round.score, 1);

  const refreshed = await syncRoundOn(sql, { ...guest, roundId: opened.round.id }, start + 70_000);
  assert.equal(refreshed.ok, true);
  if (!refreshed.ok || !refreshed.round) return;
  assert.equal(refreshed.round.phase, "revealed");
  assert.equal(refreshed.round.score, 1);
  assert.ok(refreshed.round.lines.every((line) => line.authorName));

  const otherWedding = await startRoundOn(sql, { ...person("meera-kabir", "kabirkey1", "Kabir"), prompt: "Describe the couple." }, start);
  assert.equal(otherWedding.ok, true);
  if (!otherWedding.ok || !otherWedding.round) return;
  assert.notEqual(otherWedding.round.id, opened.round.id);
  assert.equal(otherWedding.round.lines.length, 0);
  const leaked = await syncRoundOn(sql, { ...person("meera-kabir", "kabirkey1", "Kabir"), roundId: opened.round.id }, start + 71_000);
  assert.equal(leaked.ok, false);
});

test("a quiet round closes, and an unfinished guess times out as not guessed", async () => {
  const db = new PGlite();
  await db.exec(`create table circles (
    slug text primary key,
    payload jsonb not null,
    edit_key text not null,
    updated_at timestamptz not null default now()
  )`);
  const sql = sqlOf(db);
  await circle(db, "quiet-wedding");
  await circle(db, "timer-wedding");
  const start = Date.parse("2026-10-29T15:00:00.000Z");
  const quiet = await startRoundOn(sql, { ...person("quiet-wedding", "quietkey1", "Quiet"), prompt: "Any harmless secret?" }, start);
  assert.equal(quiet.ok, true);
  const closed = await syncRoundOn(sql, { ...person("quiet-wedding", "quietkey1", "Quiet") }, start + 61_000);
  assert.equal(closed.ok, true);
  if (!closed.ok || !closed.round) return;
  assert.equal(closed.round.phase, "empty");
  assert.match(closed.cards.map((item) => item.text).join("\n"), /Nobody sent a line/);

  const timer = await startRoundOn(sql, { ...person("timer-wedding", "timerkey1", "Timer"), prompt: "One sentence." }, start);
  assert.equal(timer.ok, true);
  if (!timer.ok || !timer.round) return;
  await submitLineOn(sql, { ...person("timer-wedding", "linekey01", "Lina"), roundId: timer.round.id, text: "Only one line." }, start + 1000);
  const guessing = await syncRoundOn(sql, { ...person("timer-wedding", "timerkey1", "Timer"), roundId: timer.round.id }, start + 61_000);
  assert.equal(guessing.ok, true);
  if (!guessing.ok || !guessing.round) return;
  const ended = await syncRoundOn(sql, { ...person("timer-wedding", "timerkey1", "Timer"), roundId: timer.round.id }, guessing.round.guessDeadline + 1000);
  assert.equal(ended.ok, true);
  if (!ended.ok || !ended.round) return;
  assert.equal(ended.round.phase, "revealed");
  assert.equal(ended.round.lines[0]?.result, "missed");
  assert.equal(ended.round.score, 0);
  assert.equal(ended.round.scoreText, "0 out of 1 correct");
});

test("scoring ignores a wrong or missing guess", () => {
  const statement = (id: string, authorKey: string): Statement => ({
    id, authorKey, authorName: authorKey, token: id, text: id, order: 0,
  });
  const round: Round = {
    id: "r",
    slug: "s",
    starterKey: "starter",
    starterName: "Starter",
    prompt: "p",
    phase: "guess",
    submitDeadline: 0,
    guessDeadline: 10,
    statements: [statement("a", "ada"), statement("b", "ben")],
    guesses: [{ statementId: "a", guessKey: "ada" }],
    scored: false,
    score: 0,
  };
  assert.equal(canLock(round), false);
  assert.equal(scoreOf(round), 1);
  assert.equal(resultOf(round.statements[0]!, round.guesses[0]), "correct");
  assert.equal(resultOf(round.statements[1]!, undefined), "missed");
  const view = toPublic({ ...round, phase: "guess", guesses: [] }, "guest", 1);
  assert.equal(view.lines.every((line) => !line.authorName), true);
  assert.equal(publicHasSecrets(view), false);
});

test("Seek hosts Who Said It from chat and the trophy button is gone", () => {
  const feed = readFileSync(new URL("../../components/wedding/feed-screen.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../../components/wedding/home-screen.tsx", import.meta.url), "utf8");
  const live = readFileSync(new URL("../../components/wedding/live-screen.tsx", import.meta.url), "utf8");
  const more = readFileSync(new URL("../../components/wedding/plan-screen.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/wedding/who-said-panel.tsx", import.meta.url), "utf8");
  assert.match(feed, /SeekHost/);
  assert.match(feed, /parseSeek/);
  assert.doesNotMatch(feed, /who-said-fab|who-said-trophy|WhoSaidGame/);
  assert.doesNotMatch(panel, /who-said-fab|who-said-trophy/);
  assert.match(panel, /Lock It/);
  assert.doesNotMatch(home, /SeekHost/);
  assert.doesNotMatch(live, /SeekHost/);
  assert.doesNotMatch(more, /SeekHost/);
});
