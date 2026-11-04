import assert from "node:assert/strict";
import test from "node:test";
import { accountSenderId, coupleAuthorIds, coupleRole, isOwnMessage } from "./identity.ts";

test("account ids follow the signed-in email or phone, not the display name", () => {
  const alice = { email: "Alice@Example.com", phone: "" };
  const sameName = { email: "bob@example.com", phone: "" };
  assert.equal(accountSenderId(alice), "email:alice@example.com");
  assert.notEqual(accountSenderId(alice), accountSenderId(sameName));
  assert.equal(accountSenderId({ email: "", phone: "+91 98100 12345" }), "phone:9810012345");
  assert.equal(accountSenderId(null), "");
});

test("a message is mine only when the sender id matches the signed-in account", () => {
  const alice = { email: "alice@example.com", phone: "" };
  const bob = { email: "bob@example.com", phone: "" };
  const aliceId = accountSenderId(alice);
  assert.equal(isOwnMessage(aliceId, alice), true);
  assert.equal(isOwnMessage(aliceId, bob), false);
  assert.equal(isOwnMessage(undefined, alice), false);
  assert.equal(isOwnMessage(aliceId, null), false);
  assert.equal(isOwnMessage("email:alice@example.com", { email: "ALICE@example.com", phone: "9999999999" }), true);
});

test("bride and groom follow the wedding record and stable ids, not a hard-coded name", () => {
  const wedding = {
    bride: "Meera Iyer",
    groom: "Arun Shah",
    hostName: "Meera Iyer",
    ownerEmail: "Bride@Example.com",
    posts: [
      { author: "Arun Shah", authorId: "email:imposter@example.com" },
      { author: "Arun Shah", authorId: "email:arun@example.com", comments: [{ author: "Meera Iyer", authorId: "email:bride@example.com" }] },
    ],
  };
  const ids = coupleAuthorIds(wedding);
  assert.equal(ids.bride, "email:bride@example.com");
  assert.equal(ids.groom, "email:arun@example.com");
  assert.equal(coupleRole(wedding, "Someone Else", "email:bride@example.com", ids), "bride");
  assert.equal(coupleRole(wedding, "Meera Iyer", "email:other@example.com", ids), "");
  assert.equal(coupleRole(wedding, "Meera Iyer", undefined, ids), "bride");
  assert.equal(coupleRole(wedding, "Arun Shah", "email:arun@example.com", ids), "groom");
  assert.equal(coupleRole(wedding, "Arun Shah", "email:imposter@example.com", ids), "");
  assert.equal(coupleRole(wedding, "Priya Nair", "email:priya@example.com", ids), "");
  assert.equal(coupleRole({ bride: "A", groom: "B" }, "A", undefined, { bride: "", groom: "" }), "bride");
  assert.equal(coupleRole({ bride: "A", groom: "B" }, "b", undefined, { bride: "", groom: "" }), "groom");
  assert.equal(coupleRole({ bride: "", groom: "" }, "", undefined, { bride: "", groom: "" }), "");
});

test("an explicit couple account wins over the host name", () => {
  const ids = coupleAuthorIds({
    bride: "Meera Iyer",
    groom: "Arun Shah",
    hostName: "Meera Iyer",
    ownerEmail: "host@example.com",
    coupleAccess: { bride: { accountId: "email:meera@example.com" }, groom: { accountId: "email:arun@example.com" } },
    posts: [{ author: "Meera Iyer", authorId: "email:someone-else@example.com" }],
  });
  assert.equal(ids.bride, "email:meera@example.com");
  assert.equal(ids.groom, "email:arun@example.com");
});
