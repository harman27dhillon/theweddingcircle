import assert from "node:assert/strict";
import test from "node:test";
import { cleanAffiliateFields, interpretAffiliateHttp, meeshoBlock, publicServiceView, redactSecrets } from "./affiliate.ts";
import { openJson, sealJson, signAmazonSearch } from "./affiliate.crypto.ts";

test("affiliate status never includes secret values", () => {
  const view = publicServiceView({ id: "amazon", complete: true, source: "server", attention: "" });
  assert.equal(view?.label, "Configured");
  assert.equal(JSON.stringify(view).includes("AKIA"), false);
  const blocked = publicServiceView({ id: "meesho", complete: true, source: "environment", attention: "" });
  assert.equal(blocked?.status, "needs_attention");
  assert.match(blocked?.guidance ?? "", /Additional access required/);
  const missing = publicServiceView({ id: "flipkart", complete: false, source: "none", attention: "" });
  assert.equal(missing?.label, "Not configured");
});

test("bad affiliate input is refused without echoing it", () => {
  const bad = cleanAffiliateFields("amazon", { accessKey: "short", secretKey: "x".repeat(40), partnerTag: "tag-1" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.includes("short"), false);
});

test("sealed credentials round-trip and a wrong key cannot read them", () => {
  const sealed = sealJson({ token: "super-secret-token" }, "vault-key");
  assert.equal(sealed.cipher.includes("super-secret-token"), false);
  assert.deepEqual(openJson(sealed, "vault-key"), { token: "super-secret-token" });
  assert.throws(() => openJson(sealed, "other-key"));
});

test("connection results redact secrets and do not invent a Meesho catalog", () => {
  const secret = "fk-live-token-value";
  const refused = interpretAffiliateHttp("flipkart", 401, `bad ${secret}`, [secret]);
  assert.equal(refused.status, "needs_attention");
  assert.equal(refused.message.includes(secret), false);
  const ok = interpretAffiliateHttp("flipkart", 200, '{"title":"Flipkart Affiliate API Directory","apiListings":{}}', [secret]);
  assert.equal(ok.status, "configured");
  assert.match(ok.message, /did not publish/);
  assert.match(meeshoBlock(), /not provide an authorized catalog API/);
  const redacted = redactSecrets(`token ${secret}`, [secret]);
  assert.equal(redacted.includes(secret), false);
});

test("amazon signing does not put the secret key in the request", () => {
  const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const signed = signAmazonSearch({ accessKey: "AKIAEXAMPLE", secretKey: secret, partnerTag: "wedding-21", now: new Date("2026-01-02T03:04:05.000Z") });
  assert.equal(signed.headers.Authorization.includes(secret), false);
  assert.match(signed.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
  assert.equal(signed.payload.includes(secret), false);
});
