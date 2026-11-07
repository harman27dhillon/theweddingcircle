import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWedding } from "./normalize.ts";
import { canBroadcast, codeMatch, normalizeCode } from "./format.ts";
import { RELATIONSHIPS } from "./traditions.ts";
import type { Wedding } from "./types.ts";

test("a theme change reuses chat, album, and guest data", () => {
  const raw = {
    id: "w-theme",
    slug: "aisha-rohan",
    bride: "Aisha",
    groom: "Rohan",
    cardTheme: "classic-default",
    rev: 1,
    functions: [],
    posts: [],
    guests: [],
    chats: [{ id: "c", name: "Family", hint: "", messages: [{ id: "m", author: "Aisha", text: "Hello", atLabel: "1" }] }],
    tasks: [],
    postingCodes: [{ id: "family", code: "FAMILY-AISH", kind: "family" }],
  } as unknown as Wedding;
  const first = normalizeWedding(raw);
  const nextRaw = { ...raw, cardTheme: "pastel-blush", rev: 2 } as Wedding;
  const next = normalizeWedding(nextRaw);
  assert.equal(next.cardTheme, "pastel-blush");
  assert.equal(next.chats, first.chats);
  assert.equal(next.posts, first.posts);
  assert.equal(next.guests, first.guests);
  assert.equal(next.chats[0]?.messages[0]?.text, "Hello");
  assert.equal(normalizeWedding(nextRaw), next);
});


test("wedding entry codes normalize consistently and match generated family and guest codes", () => {
  const wedding = {
    id: "w-aisha-rohan",
    slug: "aisha-rohan",
    guests: [],
    functions: [],
    posts: [],
  } as unknown as Wedding;
  assert.equal(normalizeCode("Family/VIP-Guest code: family-ohan"), "FAMILY-OHAN");
  assert.equal(normalizeCode("Guest code: guest-ohan"), "GUEST-OHAN");
  assert.equal(codeMatch(wedding, "family-ohan")?.kind, "family");
  assert.equal(codeMatch(wedding, "guest-ohan")?.kind, "guest");
});

test("family and VIP-guest members can broadcast, guest-code members cannot", () => {
  const wedding = {
    id: "w-aisha-rohan",
    slug: "aisha-rohan",
    guests: [],
    functions: [],
    posts: [],
  } as unknown as Wedding;
  assert.equal(canBroadcast(wedding, { name: "Family", role: "guest", weddingId: wedding.id, coded: true }), true);
  assert.equal(canBroadcast(wedding, { name: "Guest", role: "guest", weddingId: wedding.id, coded: false }), false);
});

test("guest relationship choices no longer split bride and groom families", () => {
  assert.ok(RELATIONSHIPS.includes("Family"));
  assert.ok(!RELATIONSHIPS.some((item) => /bride|groom/i.test(item)));
});
