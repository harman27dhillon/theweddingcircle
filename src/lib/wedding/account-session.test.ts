import assert from "node:assert/strict";
import test from "node:test";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
    clear: () => mem.clear(),
  },
});

test("sign-out parks a private wedding and the next account cannot see it", async () => {
  const { rememberCircleKey, circleKey } = await import("./circle-key.ts");
  const { rememberMemberKey, memberKeyFor } = await import("./member-key.ts");
  const { parkSignedOutSession, takeParkedSession, mergeParkedWeddings } = await import("./account-session.ts");
  mem.clear();
  rememberCircleKey("aisha-rohan", "edit-key-aisha-rohan");
  rememberMemberKey("aisha-rohan", "memberkey1");
  const sample = { id: "lila-nico", slug: "lila-nico", bride: "Lila", groom: "Nico" };
  const privateWedding = { id: "w1", slug: "aisha-rohan", bride: "Aisha", groom: "Rohan", ownerEmail: "aisha@example.com" };
  const cleared = parkSignedOutSession({
    weddings: [sample, privateWedding],
    memberships: [{ slug: "aisha-rohan", email: "aisha@example.com", name: "Aisha", role: "host" }],
    landingPins: { "email:aisha@example.com": "w1" },
    notices: [{ weddingId: "w1" }, { weddingId: "lila-nico" }],
    reports: [{ weddingId: "w1" }],
  }, { email: "aisha@example.com", phone: "" });
  assert.deepEqual(cleared.weddings.map((item) => item.slug), ["lila-nico"]);
  assert.deepEqual(cleared.memberships, []);
  assert.equal(cleared.landingPins["email:aisha@example.com"], undefined);
  assert.equal(circleKey("aisha-rohan"), "");
  assert.equal(memberKeyFor("aisha-rohan"), "");
  assert.equal(takeParkedSession({ email: "other@example.com", phone: "" }), null);
  assert.equal(circleKey("aisha-rohan"), "");
  const restored = takeParkedSession({ email: "aisha@example.com", phone: "" });
  assert.equal(restored?.weddings[0]?.slug, "aisha-rohan");
  assert.equal(circleKey("aisha-rohan"), "edit-key-aisha-rohan");
  assert.equal(memberKeyFor("aisha-rohan"), "memberkey1");
  const visible = mergeParkedWeddings([sample], restored?.weddings ?? []);
  assert.deepEqual(visible.map((item) => item.slug), ["lila-nico", "aisha-rohan"]);
  assert.equal(takeParkedSession({ email: "aisha@example.com", phone: "" }), null);
});
