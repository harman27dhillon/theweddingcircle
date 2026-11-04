import assert from "node:assert/strict";
import test from "node:test";
import { canEnterWedding, canPinLanding, pinnedWeddingId } from "./landing-pin.ts";
import type { Membership, Wedding } from "./types.ts";

function wedding(patch: Partial<Wedding>): Wedding {
  return {
    id: "w1",
    slug: "a-b",
    bride: "A",
    groom: "B",
    hostName: "A",
    date: "2026-12-01",
    city: "Pune",
    place: "Hall",
    story: "",
    cover: "",
    religion: "",
    region: "",
    cultureNote: "",
    mode: "day",
    functions: [],
    posts: [],
    guests: [],
    chats: [],
    enquiries: [],
    tasks: [],
    shortlist: [],
    places: [],
    privacy: { join: "link", post: "everyone", live: "hosts", download: true },
    liveNotes: [],
    sharingLocation: false,
    ownerEmail: "host@example.com",
    payment: { status: "paid", reference: "WC", provider: "preview", verified: true },
    ...patch,
  };
}

const host = { email: "host@example.com", phone: "", name: "Host" };
const guest = { email: "guest@example.com", phone: "", name: "Guest" };

test("only a paid circle host can pin, and the sample never qualifies", () => {
  const paid = wedding({});
  const unpaid = wedding({ id: "w2", slug: "unpaid", payment: { status: "pending", reference: "", provider: "preview" } });
  const sample = wedding({ id: "lila-nico", slug: "lila-nico", illustrated: true, ownerEmail: "host@example.com" });
  assert.equal(canPinLanding(host, [paid, unpaid], []), true);
  assert.equal(canPinLanding(guest, [paid], []), false);
  assert.equal(canPinLanding(host, [unpaid], []), false);
  assert.equal(canPinLanding(host, [sample], []), false);
  assert.equal(canPinLanding(null, [paid], []), false);
  const hostMembership: Membership = { slug: paid.slug, email: "host@example.com", name: "Host", role: "host" };
  assert.equal(canPinLanding({ email: "host@example.com", phone: "" }, [wedding({ ownerEmail: "other@example.com" })], [hostMembership]), false);
});

test("pin access follows membership and never opens the sample or a closed circle", () => {
  const paid = wedding({ guests: [{ id: "g", name: "Guest", side: "Bride", group: "", rsvp: "yes", count: 1, joined: true, arrived: false }] });
  assert.equal(canEnterWedding(paid, host, []), true);
  assert.equal(canEnterWedding(paid, guest, []), true);
  assert.equal(canEnterWedding(paid, { email: "stranger@example.com", name: "Stranger" }, []), false);
  assert.equal(canEnterWedding(wedding({ id: "lila-nico", slug: "lila-nico", illustrated: true }), host, []), false);
  assert.equal(canEnterWedding(wedding({ disabled: true }), guest, [{ slug: "a-b" }]), false);
  assert.equal(canEnterWedding(wedding({ disabled: true }), host, []), true);
  assert.equal(pinnedWeddingId({ "email:host@example.com": "w1", "email:guest@example.com": "w2" }, host), "w1");
  assert.equal(pinnedWeddingId({ "email:host@example.com": "w1" }, guest), "");
  assert.equal(pinnedWeddingId({ "email:host@example.com": "w1" }, null), "");
});
