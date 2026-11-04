import assert from "node:assert/strict";
import test from "node:test";
import { featuredCeremony, sameMessageThread } from "./ceremony-priority.ts";

const events = [
  { id: "a", name: "Roka", date: "2026-11-14", time: "10:00", live: false },
  { id: "b", name: "Mehndi", date: "2026-11-14", time: "11:00", live: false },
  { id: "c", name: "Anand Karaj", date: "2026-11-14", time: "14:00", live: true },
];

test("the featured ceremony is the live wedding-day event, not the first preliminary", () => {
  const featured = featuredCeremony(events, "2026-11-14", "2026-10-23");
  assert.equal(featured?.id, "c");
});

test("without a live flag, the latest wedding-day ceremony is featured", () => {
  const plain = events.map((item) => ({ ...item, live: false }));
  assert.equal(featuredCeremony(plain, "2026-11-14", "2026-10-23")?.id, "c");
});

test("a past main ceremony falls back to the next upcoming event", () => {
  const mixed = [
    { id: "old", name: "Earlier rite", date: "2026-10-01", time: "10:00", live: true },
    { id: "next", name: "Welcome", date: "2026-12-01", time: "18:00", live: false },
  ];
  assert.equal(featuredCeremony(mixed, "2026-10-01", "2026-10-23")?.id, "next");
});

test("a long pause or a different sender starts a new thread", () => {
  const first = { author: "Me", authorId: "email:me@example.com", at: "2026-11-14T10:00:00.000Z" };
  const close = { author: "Me", authorId: "email:me@example.com", at: "2026-11-14T10:08:00.000Z" };
  const later = { author: "Me", authorId: "email:me@example.com", at: "2026-11-14T10:40:00.000Z" };
  assert.equal(sameMessageThread(first, close, true, false), true);
  assert.equal(sameMessageThread(first, later, true, false), false);
  assert.equal(sameMessageThread(first, close, false, false), false);
  assert.equal(sameMessageThread(first, close, true, true), false);
});
