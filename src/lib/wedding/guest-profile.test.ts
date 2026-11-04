import assert from "node:assert/strict";
import test from "node:test";
import { chatSeparator, cleanLinks, commitProfile, dropNamed, mergeProfiles, prepareProfile, profileForMessage, safeHttpUrl, weddingPhase } from "./guest-profile.ts";

test("profile links accept only http and https and reject duplicates", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,hi"), "");
  assert.equal(safeHttpUrl("not a url"), "");
  assert.equal(safeHttpUrl("https://example.com/a"), "https://example.com/a");
  const saved = prepareProfile({
    displayName: "  Harman  ",
    bio: "",
    links: [
      { label: "Instagram", url: "https://example.com/a" },
      { label: "Again", url: "https://example.com/a/" },
      { url: "javascript:alert(1)" },
    ],
  });
  assert.equal(saved.ok, false);
  const unique = prepareProfile({
    displayName: "Simran (Cousin)",
    links: [{ label: "Home", url: "https://example.com/home" }],
    relationship: "",
  });
  assert.equal(unique.ok, true);
  if (unique.ok) {
    assert.equal(unique.profile.displayName, "Simran (Cousin)");
    assert.equal(unique.profile.bio, undefined);
    assert.equal(unique.profile.links?.length, 1);
    assert.equal("relationship" in unique.profile, false);
  }
  assert.equal(cleanLinks([{ url: "https://a.test" }, { url: "https://a.test" }]).length, 1);
});

test("a member can only write their own profile slot", () => {
  const first = commitProfile(undefined, "memberkey01", {
    displayName: "Harman",
    accountId: "email:one@example.com",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.ok(first);
  const stolen = commitProfile(first ?? undefined, "memberkey02", {
    displayName: "Other",
    accountId: "email:one@example.com",
    updatedAt: "2026-10-02T00:00:00.000Z",
  });
  assert.equal(stolen?.memberkey01?.displayName, "Harman");
  assert.equal(stolen?.memberkey02?.accountId, undefined);
  assert.equal(commitProfile(first ?? undefined, "nope", { displayName: "X", updatedAt: "2026-10-02T00:00:00.000Z" }), null);
});

test("profiles merge by time and a removal wins when it is newer", () => {
  const merged = mergeProfiles(
    { a: { displayName: "A", updatedAt: "2026-10-01T00:00:00.000Z" } },
    { a: { displayName: "A2", updatedAt: "2026-10-03T00:00:00.000Z" }, b: { displayName: "B", updatedAt: "2026-10-02T00:00:00.000Z" } },
  );
  assert.equal(merged.a?.displayName, "A2");
  assert.equal(merged.b?.displayName, "B");
  const dropped = dropNamed(merged, "A2", "2026-10-04T00:00:00.000Z");
  const kept = mergeProfiles(merged, dropped);
  assert.equal(kept.a?.removed, true);
  assert.equal(kept.b?.displayName, "B");
});

test("chat separators use the wedding date and ceremony names, never a guessed wedding day", () => {
  const wedding = { date: "2026-11-20", functions: [{ name: "Mehndi", date: "2026-11-18" }] };
  assert.equal(chatSeparator("2026-11-20", wedding, true, "2026-10-22"), "Wedding Day");
  assert.equal(chatSeparator("2026-11-18", wedding, true, "2026-10-22"), "Mehndi");
  assert.equal(chatSeparator("2026-10-22", wedding, true, "2026-10-22"), "Today");
  assert.equal(chatSeparator("2026-11-20", wedding, false, "2026-10-22"), "20 Nov");
  assert.equal(weddingPhase("", true, "2026-10-22"), "unknown");
  assert.equal(weddingPhase("2026-10-22", true, "2026-10-22"), "day");
  assert.equal(weddingPhase("2026-10-01", true, "2026-10-22"), "after");
});

test("a missing profile does not invent a person", () => {
  const map = { a: { displayName: "Harman", accountId: "email:h@example.com", updatedAt: "2026-10-01T00:00:00.000Z" } };
  assert.equal(profileForMessage(map, "Someone else", undefined), null);
  assert.equal(profileForMessage(map, "Old name", "email:h@example.com")?.profile.displayName, "Harman");
});
