import assert from "node:assert/strict";
import test from "node:test";
import { mergeSharedTheme, remoteThemeChoice, themeWriteDecision, withSharedTheme } from "./theme-sync.ts";

test("a host theme save is the one that reaches the shared record", () => {
  const saved = themeWriteDecision({ cardTheme: "classic-default", themeRev: 1 }, { cardTheme: "pastel-blush", themeRev: 2 }, true);
  assert.deepEqual(saved, { ok: true, cardTheme: "pastel-blush", themeRev: 2 });
});

test("a desktop that only has the old cache takes the saved theme", () => {
  const next = remoteThemeChoice(
    { cardTheme: "classic-default", themeRev: 1 },
    { cardTheme: "pastel-blush", themeRev: 2 },
    null,
  );
  assert.equal(next.cardTheme, "pastel-blush");
  assert.equal(next.themeRev, 2);
});

test("a connected device applies a newer confirmed theme without a local lock", () => {
  const next = remoteThemeChoice({ cardTheme: "royal-burgundy", themeRev: 4 }, { cardTheme: "sage-green", themeRev: 5 }, null);
  assert.equal(next.cardTheme, "sage-green");
});

test("a stale cached theme cannot overwrite a newer server theme", () => {
  const merged = mergeSharedTheme(
    { cardTheme: "pastel-blush", themeRev: 3, posts: ["keep"] },
    { cardTheme: "classic-default", themeRev: 1, posts: ["old"] },
  );
  assert.equal(merged.cardTheme, "pastel-blush");
  assert.equal(merged.themeRev, 3);
});

test("a failed save is not reported as confirmed", () => {
  const denied = themeWriteDecision({ cardTheme: "classic-default", themeRev: 2 }, { cardTheme: "royal-burgundy", themeRev: 3 }, false);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error, "denied");
  const stale = themeWriteDecision({ cardTheme: "pastel-blush", themeRev: 4 }, { cardTheme: "sage-green", themeRev: 4 }, true);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error, "stale");
    assert.equal(stale.cardTheme, "pastel-blush");
  }
});

test("reconnecting keeps the newest confirmed theme and a pending apply", () => {
  const confirmed = remoteThemeChoice({ cardTheme: "classic-default", themeRev: 1 }, { cardTheme: "royal-burgundy", themeRev: 6 }, null);
  assert.equal(confirmed.cardTheme, "royal-burgundy");
  const pending = remoteThemeChoice(
    { cardTheme: "sage-green", themeRev: 7 },
    { cardTheme: "classic-default", themeRev: 6 },
    { id: "sage-green", themeRev: 7 },
  );
  assert.equal(pending.cardTheme, "sage-green");
  assert.equal(pending.clearLock, false);
});

test("an unauthorized guest cannot change the shared theme", () => {
  const result = themeWriteDecision({ cardTheme: "classic-ivory", themeRev: 2 }, { cardTheme: "moonlight-reverie", themeRev: 9 }, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.cardTheme, "classic-ivory");
});

test("a theme save keeps unrelated wedding fields", () => {
  const next = withSharedTheme(
    { cardTheme: "classic-default", themeRev: 1, bride: "Asha", posts: ["hello"] },
    { cardTheme: "pastel-blush", themeRev: 2, bride: "Asha", posts: ["hello", "photo"] },
  );
  assert.equal(next.cardTheme, "pastel-blush");
  assert.deepEqual(next.posts, ["hello", "photo"]);
  assert.equal(next.bride, "Asha");
  const staleWrite = withSharedTheme(next, { cardTheme: "classic-default", themeRev: 2, bride: "Asha", posts: ["hello"] });
  assert.equal(staleWrite.cardTheme, "pastel-blush");
});

test("an older pull cannot undo a confirmed theme", () => {
  const next = remoteThemeChoice({ cardTheme: "velvet-rose", themeRev: 8 }, { cardTheme: "classic-default", themeRev: 3 }, null);
  assert.equal(next.cardTheme, "velvet-rose");
  assert.equal(next.themeRev, 8);
});

test("confirming the pending theme clears the lock once the server matches it", () => {
  const next = remoteThemeChoice(
    { cardTheme: "aurora-dreams", themeRev: 4 },
    { cardTheme: "aurora-dreams", themeRev: 4 },
    { id: "aurora-dreams", themeRev: 4 },
  );
  assert.equal(next.clearLock, true);
  assert.equal(next.cardTheme, "aurora-dreams");
});
