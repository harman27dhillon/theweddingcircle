import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWedding } from "./normalize.ts";
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
