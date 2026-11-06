import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { decidePurchase, interpretPlayProduct, interpretPlaySubscription } from "./billing.ts";
import { MIGRATION_PHRASE, PRODUCTION_PHRASE, appEnvironment, assessInfrastructure, decideFlag, publicInfraHealth, redactDetail, sealedBoard } from "./core.ts";
import { displayText, testResultText } from "./display.ts";
import { serviceAccountJwt, verifyServiceAccountJwt } from "./google-jwt.ts";
import { decideLive, realtimeAuthorizationHeader, realtimeConfigGap } from "./live.ts";
import { classifyRealtimeProbe, cloudflareFailure, guestPublishAllowed, judgeWebinarPresets, shouldOpenDeviceCamera, type PresetPermission } from "./realtime.ts";
import { MEDIA_LIMITS, authorizeMedia, keyBelongsToWedding } from "./media-policy.ts";
import { explainR2Http, explainR2Transport, presignS3, signS3 } from "./r2-sign.ts";

const SECRET = "super-secret-r2-value-should-never-leak";

function r2Env(extra: Record<string, string> = {}) {
  return {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
    ...extra,
  };
}

test("missing and invalid configuration stay honest", () => {
  const empty = assessInfrastructure({});
  assert.equal(empty.providers.find((item) => item.id === "r2")?.state, "not_configured");
  assert.match(empty.providers.find((item) => item.id === "r2")?.detail || "", /not configured/i);
  const partial = assessInfrastructure({ R2_ACCOUNT_ID: "a".repeat(32), R2_BUCKET: "wedding-media" });
  assert.equal(partial.providers.find((item) => item.id === "r2")?.state, "incomplete");
  const invalid = assessInfrastructure({
    FIREBASE_API_KEY: "AIzaSyA1234567890123456789012",
    FIREBASE_AUTH_DOMAIN: "wedding-circle.firebaseapp.com",
    FIREBASE_PROJECT_ID: "wedding-circle",
    FIREBASE_APP_ID: "1:123:web:abc",
    FIREBASE_SERVICE_ACCOUNT_JSON: "{not-json",
  });
  assert.equal(invalid.providers.find((item) => item.id === "firebase")?.state, "error");
  assert.equal(JSON.stringify(invalid).includes(SECRET), false);
});

test("a verified check expires when the configuration set changes", () => {
  const env = r2Env();
  const first = assessInfrastructure(env);
  const checkedAt = "2026-10-31T00:30:00.000Z";
  const check = { state: "verified", detail: "bucket ok", fingerprint: first.fingerprint.r2, checkedAt };
  const kept = assessInfrastructure(env, { r2: check });
  assert.equal(kept.providers.find((item) => item.id === "r2")?.state, "verified");
  const changed = assessInfrastructure(r2Env({ R2_BUCKET: "wedding-media-two" }), { r2: check });
  assert.equal(changed.providers.find((item) => item.id === "r2")?.state, "ready");
  assert.notEqual(changed.providers.find((item) => item.id === "r2")?.detail, "bucket ok");
});

test("developer flags cannot turn on an untested provider", () => {
  const base = { databaseExternal: false, appEnv: "development" as const };
  const untested = decideFlag({ id: "r2Media", enable: true, confirm: true, phrase: "", providers: { r2: "ready" }, ...base });
  assert.equal(untested.ok, false);
  const verified = decideFlag({ id: "r2Media", enable: true, confirm: true, phrase: "", providers: { r2: "verified" }, ...base });
  assert.equal(verified.ok, true);
  const unconfirmed = decideFlag({ id: "r2Media", enable: true, confirm: false, phrase: "", providers: { r2: "verified" }, ...base });
  assert.equal(unconfirmed.ok, false);
  const migration = decideFlag({
    id: "mediaMigration",
    enable: true,
    confirm: true,
    phrase: "wrong",
    providers: { r2: "verified" },
    ...base,
  });
  assert.equal(migration.ok, false);
  assert.match("error" in migration ? migration.error : "", new RegExp(MIGRATION_PHRASE));
  const production = decideFlag({
    id: "productionMode",
    enable: true,
    confirm: true,
    phrase: PRODUCTION_PHRASE,
    providers: {},
    databaseExternal: true,
    appEnv: "development",
  });
  assert.equal(production.ok, false);
});

test("media authorization rejects strangers, bad files, and other weddings", () => {
  assert.equal(authorizeMedia({ role: "guest", member: false, weddingId: "w1", purpose: "album", mime: "image/jpeg", bytes: 1000 }).ok, false);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "album", mime: "application/zip", bytes: 1000 }).ok, false);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "album", mime: "image/jpeg", bytes: MEDIA_LIMITS.image + 1 }).ok, false);
  const other = authorizeMedia({
    role: "guest",
    member: true,
    weddingId: "w1",
    purpose: "album",
    mime: "image/jpeg",
    bytes: 1000,
    objectKey: "weddings/w2/album/a.jpg",
  });
  assert.equal(other.ok, false);
  assert.equal(keyBelongsToWedding("weddings/w1/album/a.jpg", "w1"), true);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "album", mime: "image/jpeg", bytes: 1000 }).ok, true);
});

test("livestream stays private and does not pretend a provider exists", () => {
  const report = assessInfrastructure({});
  assert.match(report.providers.find((item) => item.id === "livestream")?.detail || "", /in-app camera/);
  assert.equal(report.providers.find((item) => item.id === "livestream")?.state, "not_configured");
  const stranger = decideLive({ providerReady: true, action: "watch", role: "guest", member: false });
  assert.equal(stranger.ok, false);
  assert.match("error" in stranger ? stranger.error : "", /private/);
  const missing = decideLive({ providerReady: false, action: "start", role: "host", member: true });
  assert.equal(missing.ok, false);
  assert.match("error" in missing ? missing.error : "", /not configured/);
  const created = decideLive({ providerReady: true, action: "create", role: "host", member: true });
  assert.equal(created.ok, true);
  const guest = decideLive({ providerReady: true, action: "create", role: "guest", member: true });
  assert.equal(guest.ok, false);
  const unconfigured = decideLive({ providerReady: false, action: "create", role: "host", member: true });
  assert.equal(unconfigured.ok, false);
});

function preset(name: string, produce: PresetPermission["audio"], accept: boolean, kick: boolean): PresetPermission {
  return { name, viewType: "WEBINAR", acceptProduction: accept, kick, audio: produce, video: produce, screenshare: produce };
}

test("a preset read succeeds only when host and guest permissions match the webinar presets", () => {
  const ready = classifyRealtimeProbe({
    status: 200,
    note: "",
    presetVerdict: judgeWebinarPresets(preset("webinar_presenter", "ALLOWED", true, true), preset("webinar_viewer", "NOT_ALLOWED", false, false)),
  });
  assert.equal(ready.ok, true);
  assert.match(ready.detail, /No meeting was created/);
  assert.equal(guestPublishAllowed(preset("webinar_viewer", "NOT_ALLOWED", false, false)), false);
  assert.equal(guestPublishAllowed(preset("webinar_viewer", "ALLOWED", false, false)), true);
  const viewerCanRequest = judgeWebinarPresets(preset("webinar_presenter", "ALLOWED", true, true), preset("webinar_viewer", "CAN_REQUEST", false, false));
  assert.equal(viewerCanRequest.ok, true);
  const viewerPublishes = judgeWebinarPresets(preset("webinar_presenter", "ALLOWED", true, true), preset("webinar_viewer", "ALLOWED", false, false));
  assert.equal(viewerPublishes.ok, false);
  assert.match(viewerPublishes.detail, /webinar_viewer/);
});

test("realtime token errors stay distinct and a meeting is not created", () => {
  const invalid = classifyRealtimeProbe({ status: 401, note: "", code: 1000 });
  assert.match(invalid.detail, /rejected/);
  const permission = classifyRealtimeProbe({ status: 403, note: "Realtime is not granted", code: 10000 });
  assert.match(permission.detail, /Realtime permission/);
  assert.equal(/not active/i.test(permission.detail), false);
  const rejected = classifyRealtimeProbe({ status: 403, note: "", code: 9109 });
  assert.match(rejected.detail, /9109/);
  const missing = classifyRealtimeProbe({ status: 404, note: "" });
  assert.match(missing.detail, /not found/);
  const offline = classifyRealtimeProbe({ status: null, note: "", network: true });
  assert.match(offline.detail, /could not be reached/);
  assert.equal(realtimeConfigGap("", "app", "a".repeat(40)).includes("account id"), true);
  assert.equal(realtimeConfigGap("a".repeat(32), "b".repeat(32), "a".repeat(40)), "");
  const token = "a".repeat(40);
  assert.equal(realtimeAuthorizationHeader(`Bearer ${token}`), `Bearer ${token}`);
  assert.equal(realtimeAuthorizationHeader(token).split("Bearer ").length - 1, 1);
  assert.equal(shouldOpenDeviceCamera("realtimekit"), false);
  assert.equal(shouldOpenDeviceCamera("in-app"), true);
});

test("an invalid Cloudflare token is not reported as connected", async () => {
  const account = "a".repeat(32);
  const app = "b".repeat(32);
  let status: number | null = null;
  let note = "";
  let code = 0;
  let network = false;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/realtime/kit/${app}/presets`, {
      headers: { authorization: `Bearer ${"c".repeat(40)}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json().catch(() => null);
    status = response.status;
    const failure = cloudflareFailure(body);
    note = failure.message;
    code = failure.code;
  } catch {
    network = true;
  }
  const verdict = classifyRealtimeProbe({ status, note, code, network, presetVerdict: null });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.detail.includes("c".repeat(40)), false);
  assert.equal(verdict.detail.toLowerCase().includes("connected"), false);
});

test("purchases are refused until Google confirms them, and duplicates do not grant twice", () => {
  const unconfirmed = decidePurchase({ configured: true, productMapped: true, api: null, existing: null, expectedProductId: "pack" });
  assert.equal(unconfirmed.ok, false);
  const mismatch = decidePurchase({
    configured: true,
    productMapped: true,
    api: { ok: true, purchaseState: 0, productId: "other" },
    existing: null,
    expectedProductId: "pack",
  });
  assert.equal(mismatch.ok, false);
  const refunded = decidePurchase({
    configured: true,
    productMapped: true,
    api: { ok: true, purchaseState: 1, productId: "pack" },
    existing: null,
    expectedProductId: "pack",
  });
  assert.equal(refunded.ok, false);
  assert.equal("revoke" in refunded && refunded.revoke, true);
  const duplicate = decidePurchase({
    configured: true,
    productMapped: true,
    api: { ok: true, purchaseState: 0, productId: "pack" },
    existing: { state: "purchased" },
    expectedProductId: "pack",
  });
  assert.equal(duplicate.ok, false);
  assert.equal("duplicate" in duplicate && duplicate.duplicate, true);
  const pending = decidePurchase({
    configured: true,
    productMapped: true,
    api: { ok: true, purchaseState: 2, productId: "pack" },
    existing: null,
    expectedProductId: "pack",
  });
  assert.equal(pending.ok, false);
  assert.equal("revoke" in pending && pending.revoke, false);
  const bought = interpretPlayProduct({ purchaseState: "0", acknowledgementState: 0, purchaseType: 0 }, "pack");
  assert.equal(bought.ok, true);
  if (bought.ok) {
    assert.equal(bought.purchaseState, 0);
    assert.equal(bought.productId, "pack");
    assert.equal(bought.acknowledgement, "pending");
    assert.equal(bought.testPurchase, true);
  }
  const omitted = interpretPlayProduct({ purchaseState: 0, acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }, "pack");
  assert.equal(omitted.ok && omitted.productId, "pack");
  const otherProduct = interpretPlayProduct({ purchaseState: 0, productId: "other" }, "pack");
  assert.equal(otherProduct.ok, false);
  const now = Date.parse("2026-11-04T00:00:00Z");
  const grace = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    lineItems: [{ productId: "member", expiryTime: "2026-12-01T00:00:00Z" }],
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  }, "member", now);
  assert.equal(grace.ok && grace.outcome, "grant");
  const canceled = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
    lineItems: [{ productId: "member", expiryTime: "2026-12-01T00:00:00Z" }],
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  }, "member", now);
  assert.equal(canceled.ok && canceled.outcome, "grant");
  const ended = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
    lineItems: [{ productId: "member", expiryTime: "2026-10-01T00:00:00Z" }],
  }, "member", now);
  assert.equal(ended.ok && ended.outcome, "revoke");
  const paused = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_PAUSED",
    lineItems: [{ productId: "member", expiryTime: "2026-12-01T00:00:00Z" }],
  }, "member", now);
  assert.equal(paused.ok && paused.outcome, "hold");
  const held = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD",
    lineItems: [{ productId: "member" }],
    testPurchaseContext: { fopType: "TEST" },
  }, "member", now);
  assert.equal(held.ok && held.outcome, "hold");
  if (held.ok) assert.equal(held.testPurchase, true);
  const expired = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
    lineItems: [{ productId: "member", expiryTime: "2026-10-01T00:00:00Z" }],
  }, "member", now);
  assert.equal(expired.ok && expired.outcome, "revoke");
  const unnamed = interpretPlaySubscription({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [{ expiryTime: "2026-12-01T00:00:00Z" }],
  }, "member", now);
  assert.equal(unnamed.ok && unnamed.productId, "member");
});

test("a developer session is required before any infrastructure status is returned", () => {
  const denied = sealedBoard({ ok: false, error: "no" }, { ok: true as const, detail: SECRET });
  assert.equal(denied.ok, false);
  assert.equal(JSON.stringify(denied).includes(SECRET), false);
  const allowed = sealedBoard({ ok: true, email: "dev@example.com" }, { ok: true as const, detail: "ready" });
  assert.equal(allowed.ok, true);
});

test("environments stay separate and secrets are stripped from errors", () => {
  assert.equal(appEnvironment({ APP_ENV: "production" }), "production");
  assert.equal(appEnvironment({}), "development");
  assert.notEqual(appEnvironment({ APP_ENV: "production" }), appEnvironment({ NODE_ENV: "development" }));
  const health = publicInfraHealth(r2Env());
  assert.equal(JSON.stringify(health).includes(SECRET), false);
  const redacted = redactDetail("fail postgres://user:secret-pass@db.example/app -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com/bucket");
  assert.equal(redacted.includes("secret-pass"), false);
  assert.equal(redacted.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(redacted.includes("r2.cloudflarestorage.com"), false);
  const tagged = redactDetail(`${"x".repeat(500)} [wc-email:enabled] [wc-rls:on]`);
  assert.match(tagged, /\[wc-email:enabled\]/);
  assert.match(tagged, /\[wc-rls:on\]/);
  assert.equal(tagged.length <= 280, true);
});

test("request signing does not put the secret in the link", () => {
  const signed = signS3({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    headers: { range: "bytes=0-9" },
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    amzDate: "20130524T000000Z",
  });
  assert.equal(signed.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  const link = presignS3({
    method: "GET",
    accountId: "a".repeat(32),
    bucket: "wedding-media",
    key: "weddings/w1/album/file.jpg",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: SECRET,
    amzDate: "20130524T000000Z",
    expiresSeconds: 60,
  });
  assert.equal(link.url.includes(SECRET), false);
  assert.equal(link.url.includes("X-Amz-Signature"), true);
});

test("a service-account assertion can be verified and is not the private key", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const token = serviceAccountJwt(
    { clientEmail: "push@wedding-circle.iam.gserviceaccount.com", privateKey },
    "https://www.googleapis.com/auth/cloud-platform",
    Date.UTC(2026, 9, 28),
  );
  assert.equal(verifyServiceAccountJwt(token, publicKey), true);
  assert.equal(token.includes(privateKey), false);
  assert.equal(token.includes("BEGIN PRIVATE KEY"), false);
});

test("a database timestamp is text before it can reach React", () => {
  assert.equal(displayText(new Date("2026-10-31T00:30:00.000Z")), "2026-10-31T00:30:00.000Z");
  assert.equal(displayText({}), "");
  assert.equal(displayText(null), "");
  assert.equal(testResultText({ ok: false, error: new Date("2026-10-31T00:30:00.000Z") }).text, "2026-10-31T00:30:00.000Z");
  assert.equal(testResultText({ ok: true, detail: "The private bucket accepted a location check." }).text, "The private bucket accepted a location check.");
  assert.equal(testResultText({ ok: false, error: { code: "X" } }).text, "The connection check failed.");
});

test("R2 failures name the transport or S3 result without repeating a secret", () => {
  const tls = explainR2Transport(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("sslv3 alert handshake failure"), { code: "ERR_SSL_TLSV1_ALERT_HANDSHAKE_FAILURE" }) }));
  assert.match(tls, /TLS connection/);
  assert.equal(tls.includes("fetch failed"), false);
  assert.match(explainR2Transport(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) })), /DNS/);
  assert.match(explainR2Transport(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }) })), /timed out/);
  const nested = explainR2Transport(Object.assign(new TypeError("fetch failed"), { cause: { errors: [Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })] } }));
  assert.match(nested, /DNS/);
  assert.equal(nested.includes("fetch failed"), false);
  assert.match(explainR2Http(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>"), /signature/);
  assert.match(explainR2Http(403, "<Error><Code>InvalidAccessKeyId</Code></Error>"), /access key id/);
  assert.match(explainR2Http(401, "<Error><Code>Unauthorized</Code></Error>"), /access key id/);
  assert.match(explainR2Http(403, "<Error><Code>AccessDenied</Code></Error>"), /permission/);
  assert.match(explainR2Http(404, "<Error><Code>NoSuchBucket</Code></Error>"), /bucket/);
  assert.equal(explainR2Http(403, `<Error><Code>AccessDenied</Code><Message>${SECRET}</Message></Error>`).includes(SECRET), false);
});

test("R2 diagnostics and data requests use the same jurisdiction endpoint", async (context) => {
  const { probeR2Bucket, openR2Read, putR2Object } = await import("./r2-sign.ts");
  const accountId = "a".repeat(32);
  const host = `${accountId}.eu.r2.cloudflarestorage.com`;
  const creds = { accountId, bucket: "wedding-media", accessKeyId: "b".repeat(32), secretAccessKey: SECRET, jurisdiction: "eu" };
  const key = "weddings/example/album/photo.jpg";
  const fetch = context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, host);
    assert.equal(init?.redirect, "manual");
    assert.equal(url.href.includes(SECRET), false);
    if (url.searchParams.has("location")) {
      assert.equal(new Headers(init?.headers).has("authorization"), true);
      return new Response('<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">EU</LocationConstraint>');
    }
    if (init?.method === "PUT") return new Response(null, { status: 200 });
    assert.equal(url.searchParams.has("X-Amz-Signature"), true);
    return new Response("photo");
  });

  assert.equal((await probeR2Bucket(creds)).ok, true);
  assert.equal((await putR2Object({ ...creds, key, contentType: "image/jpeg", body: new Uint8Array([1]) })).ok, true);
  const opened = await openR2Read({ ...creds, key });
  assert.equal(opened.ok, true);
  if (opened.ok) await opened.body?.cancel();
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal((await probeR2Bucket({ ...creds, jurisdiction: "example.invalid" })).ok, false);
  assert.equal(fetch.mock.callCount(), 3);
});

test("Google OAuth sends an encoded assertion and recovers after a transport failure", async (context) => {
  const { googleToken } = await import("./google-token.ts");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const raw = JSON.stringify({ type: "service_account", project_id: "example-project", client_email: "test@example-project.iam.gserviceaccount.com", private_key: privateKey });
  const scope = "https://www.googleapis.com/auth/firebase.readonly";
  let calls = 0;
  const request = context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    assert.equal(init?.redirect, "manual");
    assert.equal(typeof init?.body, "string");
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = form.get("assertion") || "";
    assert.equal(verifyServiceAccountJwt(assertion, publicKey), true);
    assert.equal(JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString()).scope, scope);
    calls++;
    if (calls === 1) throw new DOMException("test timeout", "TimeoutError");
    if (calls === 2) return Response.json({ access_token: "test-token" });
    if (calls === 3) return Response.json({ error: "invalid_grant", error_description: SECRET }, { status: 400 });
    return new Response(null, { status: 302, headers: { location: "https://example.test/" } });
  });

  assert.deepEqual(await googleToken(raw, scope, { retry: true }), { ok: true, token: "test-token" });
  const rejected = await googleToken(raw, scope, { retry: true });
  assert.deepEqual(rejected, { ok: false, error: "Google OAuth refused the token request (HTTP 400, invalid_grant)." });
  assert.equal(request.mock.callCount(), 3);
  assert.deepEqual(await googleToken(raw, scope, { retry: true }), { ok: false, error: "Google OAuth redirected the token request (HTTP 302)." });
  assert.equal(request.mock.callCount(), 4);
});
