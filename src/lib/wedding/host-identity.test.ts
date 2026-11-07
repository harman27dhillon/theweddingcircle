import assert from "node:assert/strict";
import test from "node:test";
import { pickMembership, reconcileCreator } from "./host-identity.ts";

test("host membership follows the account id, not a guest row with the same email", () => {
  const rows = [
    { member_key: "guest-key", role: "guest", email: "a@example.com", account_id: "" },
    { member_key: "host-key", role: "host", email: "a@example.com", account_id: "account-1" },
  ];
  const picked = pickMembership(rows, { accountId: "account-1", memberKey: "other", email: "a@example.com" });
  assert.equal(picked.review, false);
  assert.equal(picked.row?.role, "host");
  assert.equal(picked.row?.member_key, "host-key");
});

test("one host row follows the email onto a phone with a different local account id", () => {
  const rows = [{ member_key: "host-key", role: "host", email: "a@example.com", account_id: "desktop" }];
  const picked = pickMembership(rows, { accountId: "phone", email: "a@example.com" });
  assert.equal(picked.review, false);
  assert.equal(picked.row?.member_key, "host-key");
  assert.equal(picked.row?.role, "host");
});

test("a display name is not an input, and two host rows are not guessed", () => {
  const rows = [
    { member_key: "a", role: "host", email: "a@example.com", account_id: "one" },
    { member_key: "b", role: "host", email: "a@example.com", account_id: "two" },
  ];
  const picked = pickMembership(rows, { email: "a@example.com" });
  assert.equal(picked.review, true);
  assert.equal(picked.row, undefined);
  const byKey = pickMembership(rows, { memberKey: "b", email: "a@example.com" });
  assert.equal(byKey.row?.member_key, "b");
});

test("a co-host account is not promoted just because the email matches the owner", () => {
  const rows = [{ member_key: "c", role: "cohost", email: "helper@example.com", account_id: "co" }];
  const picked = pickMembership(rows, { accountId: "co", email: "owner@example.com" });
  assert.equal(picked.row?.role, "cohost");
});

test("the creator is host from the owner id, and an ambiguous email is not granted", () => {
  assert.deepEqual(
    reconcileCreator({
      ownerId: "account-1",
      ownerEmail: "a@example.com",
      accountId: "account-1",
      accountEmail: "other@example.com",
      matchingAccounts: 1,
      hasEditKey: false,
    }),
    { ownerId: "account-1", review: false, host: true },
  );
  assert.deepEqual(
    reconcileCreator({
      ownerEmail: "a@example.com",
      accountId: "account-1",
      accountEmail: "a@example.com",
      matchingAccounts: 2,
      hasEditKey: true,
    }),
    { ownerId: "", review: true, host: false },
  );
  assert.equal(
    reconcileCreator({
      ownerEmail: "a@example.com",
      accountId: "account-1",
      accountEmail: "a@example.com",
      matchingAccounts: 1,
      hasEditKey: false,
    }).host,
    false,
  );
  assert.equal(
    reconcileCreator({
      ownerEmail: "a@example.com",
      accountId: "account-1",
      accountEmail: "a@example.com",
      matchingAccounts: 1,
      hasEditKey: true,
    }).host,
    true,
  );
});

test('host and co-host management belongs only to the current wedding', async () => {
  const { canManage } = await import('./format.ts');
  const { seedWedding } = await import('./seed.ts');
  const wedding={...seedWedding,id:'owned',slug:'owned',illustrated:false};
  assert.equal(canManage(wedding,{name:'Host',role:'host',weddingId:'owned'}),true);
  assert.equal(canManage(wedding,{name:'Co-host',role:'cohost',weddingId:'owned'}),true);
  assert.equal(canManage(wedding,{name:'Host elsewhere',role:'host',weddingId:'other'}),false);
  assert.equal(canManage(wedding,{name:'Guest',role:'guest',weddingId:'owned'}),false);
});
