import assert from "node:assert/strict";
import test from "node:test";
import { VOUCHER_ALPHABET, claimVoucher, codeFromBytes, normalizeVoucherCode, redeemDecision, voucherHint, voucherLooksValid } from "./vouchers.ts";

test("voucher codes are 12 unambiguous characters", () => {
  const code = codeFromBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  assert.equal(code.length, 12);
  assert.equal(voucherLooksValid(code), true);
  assert.equal(/[0OI1]/.test(code), false);
  assert.equal(VOUCHER_ALPHABET.includes("0"), false);
  assert.equal(normalizeVoucherCode(" abcd-efgh-2345 "), "ABCDEFGH2345");
  assert.equal(voucherLooksValid("ABCDEFGH2345"), true);
  assert.equal(voucherLooksValid("ABCDEFGH234O"), false);
  assert.equal(voucherHint("ABCDEFGH2345"), "2345");
});

test("voucher decisions stay distinct and a code can be claimed only once", () => {
  assert.equal(redeemDecision(null).error, "That voucher code was not recognised.");
  assert.match(redeemDecision({ status: "redeemed" }).error || "", /already been used/);
  assert.match(redeemDecision({ status: "revoked" }).error || "", /revoked/);
  assert.match(redeemDecision({ status: "expired" }).error || "", /expired/);
  assert.match(redeemDecision({ status: "unused", expires_at: "2020-01-01T00:00:00.000Z" }).error || "", /expired/);
  const row = { status: "unused", expires_at: null };
  assert.equal(claimVoucher(row).ok, true);
  assert.equal(row.status, "redeemed");
  assert.match(claimVoucher(row).error || "", /already been used/);
  assert.equal(redeemDecision({ status: "unused" }).ok, true);
});
