import assert from "node:assert/strict";
import test from "node:test";
import {
  assignCoupleSeat,
  claimAcrossWeddings,
  claimCoupleCode,
  coupleAccessForPublish,
  issueCoupleCode,
  revokeCoupleCode,
  selfCoupleRole,
} from "./couple-access.ts";

const brideCode = "BRIDE-A1B2C3D4E5";
const groomCode = "GROOM-F6A7B8C9D0";

test("assignment uses account ids and blocks one person from both roles", () => {
  const bride = assignCoupleSeat(undefined, "bride", { accountId: "email:meera@example.com", name: "Meera" });
  assert.equal(bride.ok, true);
  if (!bride.ok) return;
  assert.equal(bride.access.bride?.accountId, "email:meera@example.com");
  const both = assignCoupleSeat(bride.access, "groom", { accountId: "email:meera@example.com", name: "Meera" });
  assert.equal(both.ok, false);
  const groom = assignCoupleSeat(bride.access, "groom", { accountId: "email:arun@example.com", name: "Arun" });
  assert.equal(groom.ok, true);
  if (!groom.ok) return;
  const cleared = assignCoupleSeat(groom.access, "bride", null);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.access.bride, undefined);
  assert.equal(cleared.access.groom?.name, "Arun");
  assert.equal(assignCoupleSeat(undefined, "bride", { accountId: "Meera", name: "Meera" }).ok, false);
  assert.equal(selfCoupleRole(groom.access, "email:meera@example.com"), "bride");
  assert.equal(selfCoupleRole(cleared.access, "email:meera@example.com"), "neither");
});

test("codes are wedding-specific, and revoked or claimed codes do not transfer", () => {
  const first = issueCoupleCode(undefined, "bride", brideCode);
  const second = issueCoupleCode(first ?? undefined, "groom", groomCode);
  assert.ok(second);
  if (!second) return;
  const published = coupleAccessForPublish(second);
  assert.equal(published?.brideCode?.code, "");
  assert.equal(published?.brideCode?.status, "active");
  const meera = claimCoupleCode(second, brideCode, "email:meera@example.com", "Meera");
  assert.equal(meera.ok, true);
  if (!meera.ok) return;
  assert.equal(meera.role, "bride");
  assert.equal(meera.access.bride?.accountId, "email:meera@example.com");
  const again = claimCoupleCode(meera.access, brideCode, "email:other@example.com", "Other");
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.error, "claimed");
  const revoked = revokeCoupleCode(issueCoupleCode(undefined, "groom", groomCode) ?? undefined, "groom");
  const used = claimCoupleCode(revoked, groomCode, "email:arun@example.com", "Arun");
  assert.equal(used.ok, false);
  if (used.ok) return;
  assert.equal(used.error, "revoked");
  const replaced = issueCoupleCode(second, "bride", "BRIDE-9999888877");
  assert.equal(claimCoupleCode(replaced ?? undefined, brideCode, "email:meera@example.com", "Meera").ok, false);
  const weddings = [
    { id: "a", slug: "wedding-a", coupleAccess: second },
    { id: "b", slug: "wedding-b", coupleAccess: issueCoupleCode(undefined, "bride", "BRIDE-BBBBBBBBBB") ?? undefined },
  ];
  const cross = claimAcrossWeddings(weddings, brideCode, "email:meera@example.com", "Meera");
  assert.equal(cross.ok, true);
  if (!cross.ok) return;
  assert.equal(cross.slug, "wedding-a");
  assert.notEqual(cross.slug, "wedding-b");
  const other = claimAcrossWeddings(weddings, "BRIDE-BBBBBBBBBB", "email:guest@example.com", "Guest");
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.equal(other.slug, "wedding-b");
  assert.equal(claimCoupleCode(second, "FAMILY-ABCD", "email:meera@example.com", "Meera").ok, false);
  assert.equal(claimCoupleCode(second, brideCode, "", "Meera").ok, false);
});
