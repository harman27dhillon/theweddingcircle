import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import { interpretRls } from "./security.ts";
import { assessInfrastructure, redactDetail } from "./core.ts";
import { membershipFromIdentity, nextMemberRole } from "../wedding/membership.ts";
import { requireVerifiedEmail, verifyFirebaseIdentity } from "../wedding/firebase-identity.ts";

const tables = ["circles", "circle_members", "circle_auth", "ceremony_invites", "couple_access"].map((name) => ({ name, rls: true }));

test("row level security is operational only when every wedding table is closed", () => {
  const closed = interpretRls({ tables, policies: [], grants: [] });
  assert.equal(closed.marker, "on");
  const open = interpretRls({ tables: tables.map((table) => table.name === "circles" ? { ...table, rls: false } : table), policies: [], grants: [] });
  assert.equal(open.marker, "off");
  const granted = interpretRls({ tables, policies: [], grants: [{ table: "circle_members", grantee: "anon", privilege: "SELECT" }] });
  assert.equal(granted.marker, "off");
  const policy = interpretRls({ tables, policies: [{ table: "circles", roles: "{public}", qual: "true" }], grants: [] });
  assert.equal(policy.marker, "off");
});

test("email password status comes from the check, not from the API key existing", () => {
  const env = {
    FIREBASE_API_KEY: "AIzaSyA1234567890123456789012",
    FIREBASE_AUTH_DOMAIN: "wedding-circle.firebaseapp.com",
    FIREBASE_PROJECT_ID: "wedding-circle",
    FIREBASE_APP_ID: "1:123456:web:abcdef",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      project_id: "wedding-circle",
      client_email: "app@wedding-circle.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----",
    }),
  };
  const unread = assessInfrastructure(env);
  const email = unread.providers.find((item) => item.id === "firebase")?.checklist.find((step) => step.label.toLowerCase().includes("email"));
  assert.match(email?.label || "", /has not been read yet/);
  assert.equal(email?.done, false);
  assert.equal(unread.providers.find((item) => item.id === "firebase")?.security, "audit");
  const mark = unread.fingerprint.firebase;
  const enabled = assessInfrastructure(env, {
    firebase: { state: "verified", detail: "Email/Password is enabled. [wc-email:enabled]", fingerprint: mark, checkedAt: "2026-11-02T00:00:00.000Z" },
  });
  const on = enabled.providers.find((item) => item.id === "firebase")?.checklist.find((step) => step.label.toLowerCase().includes("email"));
  assert.equal(on?.done, true);
  assert.match(on?.label || "", /enabled/);
  const denied = assessInfrastructure(env, {
    firebase: { state: "verified", detail: "Could not read. [wc-email:unread]", fingerprint: mark, checkedAt: "2026-11-02T00:00:00.000Z" },
  });
  const missed = denied.providers.find((item) => item.id === "firebase")?.checklist.find((step) => step.label.toLowerCase().includes("email"));
  assert.match(missed?.label || "", /not treated as disabled/);
  const rules = enabled.providers.find((item) => item.id === "firebase")?.checklist.find((step) => step.label.includes("Firestore"));
  assert.equal(rules?.tone, "na");
  const when = "2026-11-04T03:22:00.000Z";
  const kept = redactDetail(`${"Firebase project answered. ".repeat(40)} [wc-email:enabled]`);
  assert.match(kept, /\[wc-email:enabled\]/);
  assert.equal(kept.length <= 280, true);
  const afterSlice = assessInfrastructure(env, {
    firebase: { state: "verified", detail: kept, fingerprint: mark, checkedAt: when },
  });
  const sliced = afterSlice.providers.find((item) => item.id === "firebase")?.checklist.find((step) => step.label.toLowerCase().includes("email"));
  assert.equal(sliced?.done, true);
  assert.match(sliced?.label || "", /is enabled/);
  assert.match(sliced?.label || "", new RegExp(when));
  for (const marker of ["permission", "invalid", "network", "unread"] as const) {
    const row = assessInfrastructure(env, {
      firebase: { state: "verified", detail: `note [wc-email:${marker}]`, fingerprint: mark, checkedAt: when },
    });
    const step = row.providers.find((item) => item.id === "firebase")?.checklist.find((item) => item.label.toLowerCase().includes("email"));
    assert.equal(step?.done, false);
    assert.match(step?.label || "", /not treated as disabled/);
    assert.equal(/is not enabled/.test(step?.label || ""), false);
    assert.match(step?.label || "", new RegExp(when));
  }
  const cutOff = assessInfrastructure(env, {
    firebase: { state: "verified", detail: "The connection test finished before the provider tag was stored.", fingerprint: mark, checkedAt: when },
  });
  const missingTag = cutOff.providers.find((item) => item.id === "firebase")?.checklist.find((item) => item.label.toLowerCase().includes("email"));
  assert.match(missingTag?.label || "", /not stored from the last connection test/);
  assert.match(missingTag?.label || "", /not treated as disabled/);
});

test("a caller cannot raise their own role, and a Firebase email cannot invent one", () => {
  assert.equal(nextMemberRole("guest", "host", false), "guest");
  assert.equal(nextMemberRole("guest", "host", true), "host");
  assert.equal(nextMemberRole("host", "guest", true), "host");
  const denied = membershipFromIdentity({ email: "guest@example.com", claimedRole: "host", rows: [] });
  assert.equal(denied.ok, false);
  const allowed = membershipFromIdentity({
    email: "Host@Example.com",
    claimedRole: "guest",
    rows: [{ email: "host@example.com", role: "family", memberKey: "member-key" }],
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.role, "family");
});

test("a Firebase ID token is rejected for the wrong project, a bad signature, and expiry", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cert = publicKey.export({ type: "spki", format: "pem" }).toString();
  function token(payload: Record<string, unknown>, key = privateKey) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sign = createSign("RSA-SHA256");
    sign.update(`${header}.${body}`);
    sign.end();
    return `${header}.${body}.${sign.sign(key).toString("base64url")}`;
  }
  const now = Date.now();
  const good = token({
    iss: "https://securetoken.google.com/wedding-circle",
    aud: "wedding-circle",
    sub: "user-1",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
    email: "host@example.com",
  });
  const ok = verifyFirebaseIdentity(good, "wedding-circle", { test: cert }, now);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.identity.email, "host@example.com");
    assert.equal(ok.identity.emailVerified, false);
    assert.equal(requireVerifiedEmail(ok.identity).ok, false);
  }
  const verifiedToken = token({
    iss: "https://securetoken.google.com/wedding-circle",
    aud: "wedding-circle",
    sub: "user-1",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
    email: "host@example.com",
    email_verified: true,
  });
  const verified = verifyFirebaseIdentity(verifiedToken, "wedding-circle", { test: cert }, now);
  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(requireVerifiedEmail(verified.identity).ok, true);
  const other = verifyFirebaseIdentity(good, "other-project", { test: cert }, now);
  assert.equal(other.ok, false);
  const expired = token({
    iss: "https://securetoken.google.com/wedding-circle",
    aud: "wedding-circle",
    sub: "user-1",
    iat: Math.floor(now / 1000) - 7200,
    exp: Math.floor(now / 1000) - 60,
    email: "host@example.com",
  });
  assert.equal(verifyFirebaseIdentity(expired, "wedding-circle", { test: cert }, now).ok, false);
  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forged = token({
    iss: "https://securetoken.google.com/wedding-circle",
    aud: "wedding-circle",
    sub: "user-1",
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  }, otherKey);
  assert.equal(verifyFirebaseIdentity(forged, "wedding-circle", { test: cert }, now).ok, false);
});
