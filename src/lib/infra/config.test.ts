import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { firebaseKeyAllowsEmailProbe, firebaseProjectNumber, interpretFirebaseProject } from "../developer/cloud.ts";
import { assessInfrastructure, decideFlag } from "./core.ts";
import { bareCloudflareToken, classifyPlayCatalog, classifyPlayProduct, cleanProviderInput, effectiveInfraEnv, firebaseKeyDiagnostic, firebaseRuntimeFromEnv, mergeSavedConfig, normalizeWebApiKey, publicConfigForms, resolveFirebaseApiKey, vapidShapeOk } from "./config.ts";
import { openJson, sealJson } from "../wedding/affiliate.crypto.ts";

const SECRET = "super-secret-r2-value-should-never-leak";
const ACCOUNT = {
  type: "service_account",
  project_id: "wedding-circle",
  client_email: "push@wedding-circle.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIBtestprivatekeyvalue\n-----END PRIVATE KEY-----\n",
};

function firebaseInput(extra: Record<string, string> = {}) {
  return {
    FIREBASE_API_KEY: "AIzaSyA1234567890123456789012",
    FIREBASE_AUTH_DOMAIN: "wedding-circle.firebaseapp.com",
    FIREBASE_PROJECT_ID: "wedding-circle",
    FIREBASE_APP_ID: "1:123456789012:web:abcDEF1234",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(ACCOUNT),
    ...extra,
  };
}

test("firebase config rejects a private key in the web api key and keeps secrets out of the form", () => {
  const bad = cleanProviderInput("firebase", { ...firebaseInput(), FIREBASE_API_KEY: "-----BEGIN PRIVATE KEY-----" }, {});
  assert.equal(bad.ok, false);
  const saved = cleanProviderInput("firebase", firebaseInput(), {});
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const view = publicConfigForms({ environment: {}, saved: saved.fields });
  const body = JSON.stringify(view);
  assert.equal(body.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(body.includes(SECRET), false);
  const firebase = view.find((item) => item.id === "firebase");
  const json = firebase?.fields.find((field) => field.key === "FIREBASE_SERVICE_ACCOUNT_JSON");
  assert.equal(json?.value, "");
  assert.equal(json?.mask, "Saved on the server");
  assert.equal(firebase?.fields.find((field) => field.key === "FIREBASE_PROJECT_ID")?.value, "wedding-circle");
  const apiKey = firebase?.fields.find((field) => field.key === "FIREBASE_API_KEY");
  assert.equal(apiKey?.value, "");
  assert.equal(apiKey?.input, "password");
  assert.equal(apiKey?.mask, "Saved on the server");
  assert.equal(body.includes("AIzaSyA1234567890123456789012"), false);
});

test("a blank secret keeps the saved one and a new secret replaces it", () => {
  const first = cleanProviderInput("r2", {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
  }, {});
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const kept = cleanProviderInput("r2", {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: "",
  }, first.fields);
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.fields.R2_SECRET_ACCESS_KEY, SECRET);
  const replaced = cleanProviderInput("r2", {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "B".repeat(32),
    R2_SECRET_ACCESS_KEY: `${SECRET}x`,
  }, first.fields);
  assert.equal(replaced.ok, true);
  if (!replaced.ok) return;
  assert.equal(replaced.fields.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
  assert.equal(JSON.stringify(publicConfigForms({ environment: { R2_SECRET_ACCESS_KEY: SECRET }, saved: {} })).includes(SECRET), false);
});

test("invalid service-account JSON is refused and livestream stays on the in-app camera when cleared", () => {
  const invalid = cleanProviderInput("firebase", firebaseInput({ FIREBASE_SERVICE_ACCOUNT_JSON: "{not-json" }), {});
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.includes("not-json"), false);
  const cleared = cleanProviderInput("livestream", { LIVESTREAM_PROVIDER: "" }, {
    LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
    CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
    CLOUDFLARE_REALTIME_APP_ID: "c".repeat(32),
    CLOUDFLARE_REALTIME_API_TOKEN: "t".repeat(40),
    CLOUDFLARE_STREAM_API_TOKEN: "s".repeat(40),
  });
  assert.equal(cleared.ok, true);
  if (!cleared.ok) return;
  assert.equal(cleared.fields.LIVESTREAM_PROVIDER, "cloudflare-realtimekit");
  assert.equal(cleared.fields.CLOUDFLARE_ACCOUNT_ID, "b".repeat(32));
  assert.equal(cleared.fields.CLOUDFLARE_REALTIME_API_TOKEN, "t".repeat(40));
  assert.equal(cleared.fields.CLOUDFLARE_STREAM_API_TOKEN, "s".repeat(40));
  const missing = cleanProviderInput("play", {
    GOOGLE_PLAY_PACKAGE_NAME: "in.wedding.circle",
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify(ACCOUNT),
  }, {});
  assert.equal(missing.ok, false);
});

test("changing a saved secret expires a previous connection test", () => {
  const first = {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
  };
  const ready = assessInfrastructure(first);
  const changed = { ...first, R2_SECRET_ACCESS_KEY: `${SECRET}x` };
  const again = assessInfrastructure(changed);
  assert.notEqual(ready.fingerprint.r2, again.fingerprint.r2);
  const stale = assessInfrastructure(changed, {
    r2: { state: "verified", detail: "old", fingerprint: ready.fingerprint.r2, checkedAt: "2026-10-30T00:00:00.000Z" },
  });
  assert.equal(stale.providers.find((item) => item.id === "r2")?.state, "ready");
  const blocked = decideFlag({
    id: "r2Media",
    enable: true,
    confirm: true,
    phrase: "",
    providers: { r2: "ready" },
    databaseExternal: false,
    appEnv: "development",
  });
  assert.equal(blocked.ok, false);
});

test("environment values are not copied into the vault and a blank secret is kept", () => {
  const saved = {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
  };
  const merged = mergeSavedConfig({
    provider: "r2",
    incoming: { R2_SECRET_ACCESS_KEY: "", R2_PUBLIC_DOMAIN: "" },
    saved,
    environment: { R2_BUCKET: "from-env-bucket" },
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.next.R2_SECRET_ACCESS_KEY, SECRET);
  assert.equal(merged.next.R2_BUCKET, undefined);
  assert.equal(JSON.stringify(merged.next).includes("from-env-bucket"), false);
  assert.equal(merged.changed.includes("R2_SECRET_ACCESS_KEY"), false);
});

test("clearing livestream removes only its saved keys", () => {
  const merged = mergeSavedConfig({
    provider: "livestream",
    incoming: { LIVESTREAM_PROVIDER: "" },
    saved: {
      LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
      CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
      CLOUDFLARE_REALTIME_APP_ID: "c".repeat(32),
      CLOUDFLARE_REALTIME_API_TOKEN: "t".repeat(40),
      CLOUDFLARE_STREAM_API_TOKEN: "s".repeat(40),
      R2_BUCKET: "wedding-media",
    },
    environment: {},
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.next.LIVESTREAM_PROVIDER, "cloudflare-realtimekit");
  assert.equal(merged.next.CLOUDFLARE_REALTIME_API_TOKEN, "t".repeat(40));
  assert.equal(merged.next.CLOUDFLARE_STREAM_API_TOKEN, "s".repeat(40));
  assert.equal(merged.next.CLOUDFLARE_ACCOUNT_ID, "b".repeat(32));
  assert.equal(merged.next.R2_BUCKET, "wedding-media");
  assert.equal(merged.changed.includes("CLOUDFLARE_REALTIME_API_TOKEN"), false);
  assert.equal(merged.changed.includes("CLOUDFLARE_STREAM_API_TOKEN"), false);
});

test("the vault ciphertext does not contain the secret and still opens", () => {
  const sealed = sealJson({ R2_SECRET_ACCESS_KEY: SECRET, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(ACCOUNT) }, "infra-config-test-vault-key");
  assert.equal(sealed.cipher.includes(SECRET), false);
  assert.equal(sealed.cipher.includes("PRIVATE KEY"), false);
  assert.equal(sealed.nonce.includes(SECRET), false);
  const opened = openJson(sealed, "infra-config-test-vault-key");
  assert.equal(opened.R2_SECRET_ACCESS_KEY, SECRET);
  assert.throws(() => openJson(sealed, "other-key"));
});

test("play and push failures are classified without treating text as success", () => {
  assert.equal(classifyPlayCatalog(200).ok, true);
  assert.match(classifyPlayCatalog(401).detail, /refused/i);
  assert.match(classifyPlayCatalog(403).detail, /permission/i);
  assert.match(classifyPlayCatalog(404).detail, /not found/i);
  assert.equal(classifyPlayCatalog(500).ok, false);
  const empty = classifyPlayCatalog(200, {});
  assert.equal(empty.ok, true);
  assert.match(empty.detail, /empty/);
  assert.match(empty.detail, /No product was purchased/);
  const listed = classifyPlayCatalog(200, { inappproduct: [{ sku: "themes" }] });
  assert.match(listed.detail, /included 1 product/);
  const unread = classifyPlayCatalog(200, "not-json");
  assert.match(unread.detail, /could not be read/);
  const missingSku = classifyPlayProduct(404, "one_time");
  assert.equal(missingSku.kind, "missing");
  assert.doesNotMatch(missingSku.detail, /permission/i);
  const deniedSku = classifyPlayProduct(403, "subscription");
  assert.equal(deniedSku.kind, "permission");
  assert.equal(classifyPlayProduct(null, "one_time").kind, "network");
  assert.equal(vapidShapeOk("short"), false);
  assert.equal(vapidShapeOk("B".repeat(40)), true);
  assert.equal(vapidShapeOk(`-----BEGIN PRIVATE KEY-----${"B".repeat(40)}`), false);
});

test("a second save replaces the previous R2 values in the same record", () => {
  const saved = {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
  };
  const merged = mergeSavedConfig({
    provider: "r2",
    incoming: {
      ...saved,
      R2_BUCKET: "wedding-media-two",
      R2_ACCESS_KEY_ID: "B".repeat(32),
      R2_SECRET_ACCESS_KEY: `${SECRET}x`,
    },
    saved,
    environment: {},
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.write, true);
  assert.equal(merged.next.R2_BUCKET, "wedding-media-two");
  assert.equal(merged.next.R2_ACCESS_KEY_ID, "B".repeat(32));
  assert.equal(merged.next.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
  assert.equal(merged.next.R2_ACCOUNT_ID, saved.R2_ACCOUNT_ID);
  assert.equal(merged.changed.includes("R2_SECRET_ACCESS_KEY"), true);
  const blank = mergeSavedConfig({
    provider: "r2",
    incoming: { ...merged.next, R2_SECRET_ACCESS_KEY: "" },
    saved: merged.next,
    environment: {},
  });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.next.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
  assert.equal(blank.write, false);
});

test("a typed R2 replacement is stored and used even when the server environment has the old value", () => {
  const environment = {
    R2_ACCOUNT_ID: "a".repeat(32),
    R2_BUCKET: "wedding-media",
    R2_ACCESS_KEY_ID: "A".repeat(32),
    R2_SECRET_ACCESS_KEY: SECRET,
  };
  const merged = mergeSavedConfig({
    provider: "r2",
    incoming: {
      R2_ACCOUNT_ID: "b".repeat(32),
      R2_BUCKET: "wedding-media-two",
      R2_ACCESS_KEY_ID: "B".repeat(32),
      R2_SECRET_ACCESS_KEY: `${SECRET}x`,
    },
    saved: { ...environment },
    environment,
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.next.R2_ACCOUNT_ID, "b".repeat(32));
  assert.equal(merged.next.R2_BUCKET, "wedding-media-two");
  assert.equal(merged.next.R2_ACCESS_KEY_ID, "B".repeat(32));
  assert.equal(merged.next.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
  assert.equal(JSON.stringify(merged.next).includes("wedding-media\""), false);
  const view = publicConfigForms({ environment, saved: merged.next });
  const body = JSON.stringify(view);
  assert.equal(body.includes(SECRET), false);
  assert.equal(body.includes(`${SECRET}x`), false);
  const r2 = view.find((item) => item.id === "r2");
  assert.equal(r2?.fields.find((field) => field.key === "R2_BUCKET")?.value, "wedding-media-two");
  assert.equal(r2?.fields.find((field) => field.key === "R2_SECRET_ACCESS_KEY")?.value, "");
  assert.equal(r2?.fields.find((field) => field.key === "R2_SECRET_ACCESS_KEY")?.mask, "Saved on the server");
  assert.equal(r2?.fields.every((field) => field.locked === false), true);
  const effective = effectiveInfraEnv(environment, merged.next);
  assert.equal(effective.R2_BUCKET, "wedding-media-two");
  assert.equal(effective.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
  const kept = mergeSavedConfig({
    provider: "r2",
    incoming: { ...merged.next, R2_SECRET_ACCESS_KEY: "" },
    saved: merged.next,
    environment,
  });
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.next.R2_SECRET_ACCESS_KEY, `${SECRET}x`);
});

test("a normal RealtimeKit token is saved and a typed token without the provider is refused", () => {
  const token = `Bearer ${"a".repeat(20)}.${"b".repeat(19)}`;
  const account = "b".repeat(32);
  const app = "c".repeat(32);
  const saved = cleanProviderInput("livestream", {
    LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_REALTIME_APP_ID: app,
    CLOUDFLARE_REALTIME_API_TOKEN: token,
  }, {});
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.fields.CLOUDFLARE_REALTIME_API_TOKEN, bareCloudflareToken(token));
  assert.equal(saved.fields.CLOUDFLARE_REALTIME_API_TOKEN.includes("Bearer"), false);
  assert.equal(bareCloudflareToken(`"Bearer ${"c".repeat(40)}"`), "c".repeat(40));
  const previous = {
    LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_REALTIME_APP_ID: app,
    CLOUDFLARE_REALTIME_API_TOKEN: "d".repeat(40),
    CLOUDFLARE_STREAM_API_TOKEN: "s".repeat(40),
  };
  const echoed = cleanProviderInput("livestream", {
    LIVESTREAM_PROVIDER: "",
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_REALTIME_API_TOKEN: "",
  }, previous);
  assert.equal(echoed.ok, true);
  if (!echoed.ok) return;
  assert.equal(echoed.fields.CLOUDFLARE_REALTIME_API_TOKEN, previous.CLOUDFLARE_REALTIME_API_TOKEN);
  assert.equal(echoed.fields.CLOUDFLARE_STREAM_API_TOKEN, previous.CLOUDFLARE_STREAM_API_TOKEN);
  const typed = `${"e".repeat(40)}`;
  const refused = cleanProviderInput("livestream", {
    LIVESTREAM_PROVIDER: "",
    CLOUDFLARE_ACCOUNT_ID: account,
    CLOUDFLARE_REALTIME_API_TOKEN: typed,
  }, previous);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.match(refused.error, /Select cloudflare-realtimekit/);
    assert.equal(refused.error.includes(typed), false);
  }
  const blank = mergeSavedConfig({
    provider: "livestream",
    incoming: { LIVESTREAM_PROVIDER: "cloudflare-realtimekit", CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_REALTIME_APP_ID: app, CLOUDFLARE_REALTIME_API_TOKEN: "" },
    saved: previous,
    environment: {},
  });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.next.CLOUDFLARE_REALTIME_API_TOKEN, previous.CLOUDFLARE_REALTIME_API_TOKEN);
  assert.equal(blank.next.CLOUDFLARE_STREAM_API_TOKEN, previous.CLOUDFLARE_STREAM_API_TOKEN);
});

test("environment-only fields stay replaceable and vault values override them", () => {
  const token = "f".repeat(40);
  const environment = {
    FIREBASE_PROJECT_ID: "env-id",
    FIREBASE_STORAGE_BUCKET: "env.appspot.com",
    FIREBASE_SERVICE_ACCOUNT_JSON: "{\"env\":true}",
    LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_REALTIME_APP_ID: "c".repeat(32),
    CLOUDFLARE_REALTIME_API_TOKEN: token,
  };
  const view = publicConfigForms({ environment, saved: {} });
  const livestream = view.find((item) => item.id === "livestream");
  const field = livestream?.fields.find((item) => item.key === "CLOUDFLARE_REALTIME_API_TOKEN");
  assert.equal(field?.locked, true);
  assert.equal(field?.value, "");
  assert.equal(field?.present, true);
  assert.equal(JSON.stringify(view).includes(token), false);
  const replacement = "g".repeat(40);
  const merged = mergeSavedConfig({
    provider: "livestream",
    incoming: {
      LIVESTREAM_PROVIDER: "cloudflare-realtimekit",
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CLOUDFLARE_REALTIME_APP_ID: "c".repeat(32),
      CLOUDFLARE_REALTIME_API_TOKEN: replacement,
    },
    saved: {},
    environment,
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.next.CLOUDFLARE_REALTIME_API_TOKEN, replacement);
  const runtime = firebaseRuntimeFromEnv(effectiveInfraEnv(
    { FIREBASE_PROJECT_ID: "env-id", FIREBASE_STORAGE_BUCKET: "env.appspot.com", FIREBASE_SERVICE_ACCOUNT_JSON: "env-json" },
    { FIREBASE_PROJECT_ID: "vault-id", FIREBASE_STORAGE_BUCKET: "vault.appspot.com" },
  ));
  assert.equal(runtime.projectId, "env-id");
  assert.equal(runtime.storageBucket, "env.appspot.com");
  assert.equal(runtime.serviceAccountJson, "env-json");
  const quoted = "AIzaSyQuotedKeyValue0000000008jAc";
  const dirty = `"${quoted}"`;
  const other = "AIzaSyOtherKeyValue0000000000abcd";
  assert.equal(normalizeWebApiKey(`Bearer ${dirty}`), quoted);
  assert.equal(firebaseKeyDiagnostic(resolveFirebaseApiKey(other, dirty)).includes(quoted), false);
  assert.equal(firebaseKeyDiagnostic(resolveFirebaseApiKey(other, dirty)).includes(other), false);
  const chosen = resolveFirebaseApiKey(other, dirty);
  assert.equal(chosen.key, other);
  assert.equal(chosen.last4, other.slice(-4));
  assert.equal(chosen.savedOverridesEnvironment, false);
  assert.equal(chosen.source, "server environment");
  const ignored = resolveFirebaseApiKey(quoted, "not-a-key");
  assert.equal(ignored.key, quoted);
  assert.equal(ignored.malformedSavedIgnored, true);
  assert.equal(ignored.source, "server environment");
  const previous = firebaseInput({ FIREBASE_API_KEY: quoted });
  const blankKey = mergeSavedConfig({
    provider: "firebase",
    incoming: { ...previous, FIREBASE_API_KEY: "" },
    saved: previous,
    environment: { FIREBASE_API_KEY: other },
  });
  assert.equal(blankKey.ok, true);
  if (blankKey.ok) assert.equal(blankKey.next.FIREBASE_API_KEY, other);
  assert.equal(effectiveInfraEnv({ FIREBASE_API_KEY: other }, { FIREBASE_API_KEY: dirty }).FIREBASE_API_KEY, quoted);
  const blank = mergeSavedConfig({
    provider: "livestream",
    incoming: { LIVESTREAM_PROVIDER: "cloudflare-realtimekit", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_REALTIME_APP_ID: "c".repeat(32), CLOUDFLARE_REALTIME_API_TOKEN: "" },
    saved: merged.next,
    environment,
  });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.next.CLOUDFLARE_REALTIME_API_TOKEN, replacement);
});

test("firebase identity, storage, and the infrastructure test use the resolved project number and vault", () => {
  const identity = readFileSync(new URL("../wedding/firebase-identity.server.ts", import.meta.url), "utf8");
  const infra = readFileSync(new URL("./infra.server.ts", import.meta.url), "utf8");
  const cloud = readFileSync(new URL("../developer/cloud.server.ts", import.meta.url), "utf8");
  const form = readFileSync(new URL("../../components/wedding/developer-infrastructure.tsx", import.meta.url), "utf8");
  assert.match(identity, /resolvedInfraEnv/);
  assert.match(identity, /firebaseRuntimeFromEnv/);
  assert.equal(identity.includes("process.env.FIREBASE_PROJECT_ID"), false);
  assert.match(identity, /never creates a membership/);
  const sequence = infra.slice(infra.indexOf("getProjectConfig"));
  assert.ok(sequence.indexOf("firebaseProjectNumber") >= 0);
  assert.ok(sequence.indexOf("firebaseKeyAllowsEmailProbe") >= 0);
  assert.ok(sequence.indexOf("firebaseKeyAllowsEmailProbe") < sequence.indexOf("accounts:signInWithPassword"));
  assert.match(infra, /realtimeAuthorizationHeader/);
  assert.match(cloud, /firebaseProjectNumber\(raw\.appId \|\| "", raw\.messagingSenderId \|\| ""\)/);
  assert.equal(form.includes("disabled={field.locked}"), false);
  assert.match(form, /typed value is stored/);
  const number = "637941576967";
  const slug = "the-wedding-circle-b31b6";
  const connected = interpretFirebaseProject(
    200,
    JSON.stringify({ projectId: number, authorizedDomains: [`${slug}.firebaseapp.com`] }),
    slug,
    [],
    `${slug}.firebaseapp.com`,
    firebaseProjectNumber(`1:${number}:web:abcDEF1234`),
  );
  assert.equal(connected.state, "connected");
  assert.equal(firebaseKeyAllowsEmailProbe(connected.state), true);
  const mismatch = interpretFirebaseProject(200, JSON.stringify({ projectId: "other-app" }), slug, []);
  assert.equal(mismatch.state, "error");
  assert.equal(firebaseKeyAllowsEmailProbe(mismatch.state), false);
  assert.match(mismatch.detail, /Email\/Password was not checked/);
});

