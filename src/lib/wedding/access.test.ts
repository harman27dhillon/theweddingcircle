import assert from "node:assert/strict";
import test from "node:test";
import { redactWedding } from "./access.ts";
import type { Wedding } from "./types.ts";

function wedding(): Wedding {
  return {
    id: "asha",
    slug: "asha-rohan",
    bride: "Asha",
    groom: "Rohan",
    hostName: "Host",
    date: "2026-12-01",
    city: "Amritsar",
    place: "Hall",
    story: "A wedding",
    cover: "/cover.jpg",
    religion: "",
    region: "",
    cultureNote: "",
    mode: "day",
    functions: [],
    posts: [],
    guests: [],
    chats: [{ id: "hall", name: "Hall", hint: "", messages: [{ id: "m1", author: "Asha", text: "private", atLabel: "Now" }] }],
    enquiries: [],
    tasks: [{ id: "t", label: "Pay", done: false }],
    shortlist: [],
    places: [],
    privacy: { join: "code" },
    liveNotes: [],
    sharingLocation: false,
    postingCodes: [{ id: "guest", code: "SECRET-CODE" }],
    mediaKey: "media-secret-value",
    ownerEmail: "host@example.com",
    payment: { status: "paid", verified: true },
    coupleAccess: { brideCode: { code: "BRIDE-SECRET-CODE", status: "active" } },
  } as unknown as Wedding;
}

test("a guest or stranger does not receive codes, media keys, or private chat", () => {
  const stranger = redactWedding(wedding(), null);
  assert.equal(stranger.mediaKey, undefined);
  assert.equal(stranger.postingCodes?.length, 0);
  assert.equal(stranger.chats.length, 0);
  assert.equal(stranger.ownerEmail, undefined);
  assert.equal(stranger.payment, undefined);
  assert.equal(stranger.coupleAccess?.brideCode?.code, "");
  const guest = redactWedding(wedding(), { name: "Asha", role: "guest" });
  assert.equal(guest.mediaKey, undefined);
  assert.equal(guest.postingCodes?.length, 0);
  assert.equal(guest.chats.length, 1);
  const host = redactWedding(wedding(), { name: "Host", role: "host" });
  assert.equal(host.mediaKey, "media-secret-value");
  assert.equal(host.postingCodes?.[0]?.code, "SECRET-CODE");
});
