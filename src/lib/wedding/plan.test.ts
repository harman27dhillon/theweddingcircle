import assert from "node:assert/strict";
import test from "node:test";
import { FREE_STORAGE_BYTES, PREMIUM_STORAGE_BYTES, isPremiumWedding, lockServerPayment, overFreeStorage, overPlanStorage, planLimited, retainVerifiedPayment, storageLimitBytes, storedMediaBytes, weddingStorageBytes } from "./plan.ts";

test("a verified purchase stays premium and an unverified one does not", () => {
  type Pay = { status: "paid" | "pending" | "failed"; verified: boolean; reference: string };
  const verified: Pay = { status: "paid", verified: true, reference: "WC-1" };
  const pending: Pay = { status: "pending", verified: false, reference: "" };
  const previewPaid: Pay = { status: "paid", verified: false, reference: "WC-PREVIEW" };
  assert.equal(isPremiumWedding({ payment: verified, slug: "a-b" }), true);
  assert.deepEqual(retainVerifiedPayment(pending, verified), verified);
  assert.deepEqual(retainVerifiedPayment(verified, pending), verified);
  assert.equal(isPremiumWedding({ payment: retainVerifiedPayment(verified, previewPaid) ?? undefined, slug: "a-b" }), true);
  assert.equal(isPremiumWedding({ payment: retainVerifiedPayment(previewPaid, pending) ?? undefined, slug: "a-b" }), false);
  assert.deepEqual(lockServerPayment(verified, pending), { ...verified, status: "paid", verified: true });
  const overwritten: Pay = { status: "pending", verified: true, reference: "VOUCHER-1" };
  const failed: Pay = { status: "failed", verified: true, reference: "WC-FAIL" };
  assert.equal(isPremiumWedding({ payment: overwritten, slug: "a-b" }), true);
  assert.equal(isPremiumWedding({ payment: failed, slug: "a-b" }), false);
  assert.equal(retainVerifiedPayment(overwritten, previewPaid)?.status, "paid");
  assert.equal(lockServerPayment(overwritten, previewPaid)?.status, "paid");
  assert.equal(lockServerPayment(failed, previewPaid)?.status, "failed");
  assert.equal(lockServerPayment(failed, previewPaid)?.verified, true);
  assert.equal(lockServerPayment(previewPaid, { ...previewPaid, verified: true })?.verified, false);
  assert.equal(lockServerPayment(undefined, pending)?.verified, false);
});

test("only a verified purchase is premium, and a preview payment is not", () => {
  assert.equal(isPremiumWedding({ payment: { status: "paid", verified: true }, slug: "a-b" }), true);
  assert.equal(isPremiumWedding({ payment: { status: "paid" }, slug: "a-b" }), false);
  assert.equal(isPremiumWedding({ payment: { status: "pending" }, slug: "a-b" }), false);
  assert.equal(planLimited({ payment: { status: "paid" }, slug: "a-b" }), true);
  assert.equal(planLimited({ payment: { status: "paid", verified: true }, slug: "a-b" }), false);
  assert.equal(planLimited({ id: "lila-nico", slug: "lila-nico", illustrated: true }), false);
  assert.equal(storageLimitBytes({ payment: { status: "paid" }, slug: "a-b" }), FREE_STORAGE_BYTES);
  assert.equal(storageLimitBytes({ payment: { status: "paid", verified: true }, slug: "a-b" }), PREMIUM_STORAGE_BYTES);
  assert.equal(FREE_STORAGE_BYTES, 500 * 1024 * 1024);
  assert.equal(PREMIUM_STORAGE_BYTES, 10 * 1024 * 1024 * 1024);
});

test("inline photos count toward the 500 MB free limit and a short note does not", () => {
  const photo = `data:image/jpeg;base64,${"A".repeat(8)}`;
  assert.equal(storedMediaBytes("https://example.com/a.jpg"), 0);
  assert.equal(storedMediaBytes(photo), 6);
  const wedding = { posts: [{ images: [photo], text: "hello" } as { images: string[] }] };
  assert.equal(weddingStorageBytes(wedding), 6);
  assert.equal(overFreeStorage(FREE_STORAGE_BYTES, 1), true);
  assert.equal(overFreeStorage(FREE_STORAGE_BYTES - 6, 6), false);
  assert.equal(overPlanStorage({ slug: "a-b", payment: { status: "paid" } }, FREE_STORAGE_BYTES, 1), true);
  assert.equal(overPlanStorage({ slug: "a-b", payment: { status: "paid", verified: true } }, FREE_STORAGE_BYTES, 1), false);
});