import assert from "node:assert/strict";
import test from "node:test";
import {
  FIREBASE_FIELDS,
  SUPABASE_FIELDS,
  buildCloudBoard,
  cleanFirebaseInput,
  cleanSupabaseInput,
  decideCloudApply,
  decideServiceRequest,
  fcmReport,
  interpretEmailPassword,
  interpretFirebaseProject,
  interpretFirebaseStorage,
  interpretPasswordProbe,
  interpretSupabaseHealth,
  interpretSupabaseProbe,
  firebaseKeyAllowsEmailProbe,
  firebaseProjectNumber,
  maskTail,
  parseServiceAccount,
  publicRuntimeView,
  redactCloud,
  supabaseFormStatus,
} from "./cloud.ts";

function jwt(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${body}.signaturevalue`;
}

function emptyFirebaseFields() {
  return FIREBASE_FIELDS.map((field) => ({
    id: field.id,
    label: field.label,
    env: field.env,
    secret: field.secret,
    optional: "optional" in field && field.optional === true,
    present: false,
    hint: "",
    source: "none" as const,
  }));
}

test("supabase form accepts an anon key and refuses a service-role key without echoing it", () => {
  const marker = "svc-marker-9912-do-not-leak";
  const denied = cleanSupabaseInput({
    projectUrl: "https://abcd.supabase.co",
    publishableKey: jwt({ role: "service_role", marker }),
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.error.includes(marker), false);
    assert.equal(denied.error.includes("service_role"), false);
  }
  const secretKey = cleanSupabaseInput({
    projectUrl: "https://abcd.supabase.co",
    publishableKey: `sb_secret_${"k".repeat(24)}`,
  });
  assert.equal(secretKey.ok, false);
  const accepted = cleanSupabaseInput({
    projectUrl: "https://abcd.supabase.co/extra",
    publishableKey: jwt({ role: "anon" }),
  });
  assert.equal(accepted.ok, false);
  const ok = cleanSupabaseInput({
    projectUrl: "https://abcd.supabase.co",
    publishableKey: `sb_publishable_${"a".repeat(24)}`,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.fields.projectUrl, "https://abcd.supabase.co");
});

test("firebase web config is checked and a private key is refused", () => {
  const bad = cleanFirebaseInput({
    apiKey: "not-a-key",
    authDomain: "app.firebaseapp.com",
    projectId: "wedding-circle",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.includes("not-a-key"), false);
  const leaked = "-----BEGIN PRIVATE KEY-----\nMII-secret";
  const file = cleanFirebaseInput({
    apiKey: "AIzaSyA1234567890123456789012",
    authDomain: "app.firebaseapp.com",
    projectId: "wedding-circle",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
    storageBucket: leaked,
  });
  assert.equal(file.ok, false);
  if (!file.ok) assert.equal(file.error.includes("MII-secret"), false);
  const ok = cleanFirebaseInput({
    apiKey: "AIzaSyA1234567890123456789012",
    authDomain: "app.firebaseapp.com",
    projectId: "wedding-circle",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef",
    measurementId: "g-abc123",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.fields.measurementId, "G-ABC123");
  assert.equal(ok.ok && "storageBucket" in ok.fields, false);
});

test("connection results redact keys and do not treat messaging config as connected", () => {
  const key = "AIzaSyA1234567890123456789012";
  const health = interpretSupabaseHealth(401, `refused ${key}`, [key]);
  assert.equal(health.state, "error");
  assert.equal(health.detail.includes(key), false);
  const project = interpretFirebaseProject(400, `API key ${key} invalid`, "wedding-circle", [key]);
  assert.equal(project.detail.includes(key), false);
  assert.equal(project.state, "error");
  const restricted = interpretFirebaseProject(403, '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"API_KEY_HTTP_REFERRER_BLOCKED"}]}}', "wedding-circle", [key]);
  assert.equal(restricted.state, "needs_setup");
  assert.equal(restricted.detail.includes(key), false);
  const same = interpretFirebaseProject(200, JSON.stringify({ projectId: "Wedding-Circle", authorizedDomains: ["wedding-circle.firebaseapp.com"] }), "wedding-circle", [key], "wedding-circle.firebaseapp.com");
  assert.equal(same.state, "connected");
  const missingId = interpretFirebaseProject(200, JSON.stringify({ authorizedDomains: ["wedding-circle.firebaseapp.com"] }), "wedding-circle", [key], "wedding-circle.firebaseapp.com");
  assert.equal(missingId.state, "needs_setup");
  assert.match(missingId.detail, /not a project mismatch/);
  const other = interpretFirebaseProject(200, JSON.stringify({ projectId: "other-app", note: "wedding-circle" }), "wedding-circle", [key]);
  assert.equal(other.state, "error");
  assert.match(other.detail, /other-app/);
  assert.match(other.detail, /wedding-circle/);
  const domain = interpretFirebaseProject(200, JSON.stringify({ projectId: "wedding-circle", authorizedDomains: ["localhost"] }), "wedding-circle", [], "auth.example.com");
  assert.equal(domain.state, "error");
  assert.match(domain.detail, /auth domain/);
  const defaultHost = interpretFirebaseProject(200, JSON.stringify({ projectId: "wedding-circle", authorizedDomains: ["localhost"] }), "wedding-circle", [], "wedding-circle.firebaseapp.com");
  assert.equal(defaultHost.state, "connected");
  const slug = "the-wedding-circle-b31b6";
  const number = "637941576967";
  const appId = `1:${number}:web:abcDEF1234`;
  assert.equal(firebaseProjectNumber(appId, "111111111111"), number);
  assert.equal(firebaseProjectNumber("not-an-app-id", number), number);
  const numeric = interpretFirebaseProject(
    200,
    JSON.stringify({ projectId: Number(number), authorizedDomains: [`${slug}.firebaseapp.com`] }),
    slug,
    [],
    `${slug}.firebaseapp.com`,
    firebaseProjectNumber(appId, number),
  );
  assert.equal(numeric.state, "connected");
  assert.equal(/different projects/i.test(numeric.detail), false);
  assert.match(numeric.detail, /was not compared|checked separately/);
  assert.equal(firebaseKeyAllowsEmailProbe(numeric.state), true);
  const wrongNumber = interpretFirebaseProject(
    200,
    JSON.stringify({ projectId: number, authorizedDomains: [`${slug}.firebaseapp.com`] }),
    slug,
    [],
    `${slug}.firebaseapp.com`,
    "111111111111",
  );
  assert.equal(wrongNumber.state, "error");
  assert.match(wrongNumber.detail, /Internal check/);
  assert.match(wrongNumber.detail, new RegExp(number));
  assert.match(wrongNumber.detail, /111111111111/);
  assert.match(wrongNumber.detail, /Email\/Password was not checked/);
  assert.equal(firebaseKeyAllowsEmailProbe(wrongNumber.state), false);
  const google = interpretFirebaseProject(400, "bad request", slug, []);
  assert.match(google.detail, /without a recognized error code/);
  assert.equal(google.detail.includes("bad request"), false);
  assert.match(google.detail, /Email\/Password was not checked/);
  assert.equal(/Email\/Password was not checked/.test(restricted.detail), false);
  assert.equal(firebaseKeyAllowsEmailProbe(restricted.state), true);
  const enabled = interpretEmailPassword(200, JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }));
  assert.equal(enabled.marker, "enabled");
  const link = interpretEmailPassword(200, JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: false } } }));
  assert.equal(link.marker, "link");
  const off = interpretEmailPassword(200, JSON.stringify({ signIn: { email: { enabled: false, passwordRequired: true } } }));
  assert.equal(off.marker, "disabled");
  assert.match(off.detail, /not enabled/);
  const denied = interpretEmailPassword(403, '{"error":{"status":"PERMISSION_DENIED"}}');
  assert.equal(denied.marker, "permission");
  assert.match(denied.detail, /does not mean the provider is disabled/);
  assert.equal(denied.detail.toLowerCase().includes("not enabled"), false);
  const invalid = interpretEmailPassword(401, '{"error":{"status":"UNAUTHENTICATED"}}');
  assert.equal(invalid.marker, "invalid");
  assert.match(invalid.detail, /not marked disabled/);
  const down = interpretEmailPassword(503, "{}");
  assert.equal(down.marker, "network");
  assert.match(down.detail, /not marked disabled/);
  const malformed = interpretEmailPassword(200, "{not-json");
  assert.equal(malformed.marker, "unread");
  assert.match(malformed.detail, /not marked disabled/);
  const missingField = interpretEmailPassword(200, JSON.stringify({ signIn: {} }));
  assert.equal(missingField.marker, "unread");
  const probeOn = interpretPasswordProbe(400, '{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}');
  assert.equal(probeOn.marker, "enabled");
  const probeOff = interpretPasswordProbe(400, '{"error":{"message":"PASSWORD_LOGIN_DISABLED"}}');
  assert.equal(probeOff.marker, "disabled");
  const probeBlocked = interpretPasswordProbe(403, '{"error":{"message":"API_KEY_HTTP_REFERRER_BLOCKED"}}');
  assert.equal(probeBlocked.marker, "permission");
  assert.match(probeBlocked.detail, /does not mean the provider is disabled/);
  const probeKey = interpretPasswordProbe(400, '{"error":{"message":"API_KEY_INVALID"}}');
  assert.equal(probeKey.marker, "invalid");
  const probeDown = interpretPasswordProbe(503, "{}");
  assert.equal(probeDown.marker, "network");
  const account = parseServiceAccount(JSON.stringify({
    type: "service_account",
    project_id: "wedding-circle",
    client_email: "app@wedding-circle.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\\nline\\n-----END PRIVATE KEY-----",
  }));
  assert.equal(account.ok, true);
  if (account.ok) assert.equal(account.privateKey.includes("\n"), true);
  const blocked = interpretFirebaseStorage(403);
  assert.equal(blocked.state, "connected");
  assert.match(blocked.detail, /not copied|were not switched|were not copied|not switched|not copied/);
  const missing = interpretFirebaseStorage(404);
  assert.equal(missing.state, "error");
  const push = fcmReport({ sender: true, appId: true, vapid: true });
  assert.equal(push.state, "needs_setup");
  assert.equal(push.checks.some((item) => item.id === "worker" && item.ok), false);
  assert.equal(redactCloud(`token ${key}`, [key]).includes(key), false);
});

test("firebase project errors keep a late restriction and never echo provider text", () => {
  const secret = "AIzaSyFAKEKEY1234567890123456789012";
  const privateKey = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----";
  const pad = "x".repeat(320);
  const late = JSON.stringify({
    noise: pad,
    leak: secret,
    privateKey,
    error: {
      status: "PERMISSION_DENIED",
      message: "API_KEY_SERVICE_BLOCKED",
      details: [{ reason: "API_KEY_SERVICE_BLOCKED" }],
    },
  });
  assert.ok(late.indexOf("API_KEY_SERVICE_BLOCKED") > 240);
  const blocked = interpretFirebaseProject(403, late, "wedding-circle", [secret]);
  assert.equal(blocked.state, "error");
  assert.match(blocked.detail, /HTTP 403; API_KEY_SERVICE_BLOCKED/);
  assert.match(blocked.detail, /Identity Toolkit is allowed/);
  assert.equal(blocked.detail.includes(secret), false);
  assert.equal(blocked.detail.includes("PRIVATE KEY"), false);
  assert.equal(blocked.detail.includes(pad), false);
  const invalid = interpretFirebaseProject(400, JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API_KEY_INVALID", leak: secret } }), "wedding-circle", [secret]);
  assert.match(invalid.detail, /HTTP 400; API_KEY_INVALID/);
  assert.match(invalid.detail, /invalid web API key/);
  assert.equal(invalid.detail.includes(secret), false);
  const denied = interpretFirebaseProject(403, JSON.stringify({ error: { status: "PERMISSION_DENIED", message: `The caller does not have permission. ${secret}` } }), "wedding-circle", [secret]);
  assert.match(denied.detail, /HTTP 403; PERMISSION_DENIED/);
  assert.match(denied.detail, /does not prove the web API key is invalid/);
  assert.equal(denied.detail.includes(secret), false);
  assert.equal(denied.detail.includes("The caller does not have permission"), false);
  const malformed = interpretFirebaseProject(400, `not-json ${secret} ${privateKey}`, "wedding-circle", [secret]);
  assert.match(malformed.detail, /without a recognized error code/);
  assert.equal(malformed.detail.includes(secret), false);
  assert.equal(malformed.detail.includes("PRIVATE KEY"), false);
  assert.equal(malformed.detail.includes("not-json"), false);
  const unauthenticated = interpretFirebaseProject(401, JSON.stringify({ error: { status: "UNAUTHENTICATED", leak: secret } }), "wedding-circle", [secret]);
  assert.match(unauthenticated.detail, /HTTP 401; UNAUTHENTICATED/);
  assert.equal(unauthenticated.detail.includes(secret), false);
  const buried = `${"a".repeat(280)}{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"API_KEY_HTTP_REFERRER_BLOCKED"}]}}`;
  assert.ok(buried.indexOf("API_KEY_HTTP_REFERRER_BLOCKED") > 240);
  const referrer = interpretFirebaseProject(403, buried, "wedding-circle", [secret]);
  assert.equal(referrer.state, "needs_setup");
  assert.match(referrer.detail, /browser or IP restriction/);
  assert.equal(referrer.detail.includes("Firebase rejected the web API key"), false);
  assert.equal(referrer.detail.includes(secret), false);
});

test("service requests cannot switch core data, push, or live media", () => {
  const core = decideServiceRequest({
    service: "records",
    choice: "firebase",
    confirm: true,
    supabaseStorage: "connected",
    firebaseStorage: "connected",
    measurementConfigured: true,
    fcmReady: true,
  });
  assert.equal(core.ok, false);
  const early = decideServiceRequest({
    service: "media",
    choice: "supabase_storage",
    confirm: true,
    supabaseStorage: "needs_setup",
    firebaseStorage: "not_configured",
    measurementConfigured: false,
    fcmReady: false,
  });
  assert.equal(early.ok, false);
  const recorded = decideServiceRequest({
    service: "media",
    choice: "firebase_storage",
    confirm: true,
    supabaseStorage: "not_configured",
    firebaseStorage: "connected",
    measurementConfigured: false,
    fcmReady: false,
  });
  assert.equal(recorded.ok, true);
  if (recorded.ok) {
    assert.match(recorded.message, /still use this app's library/);
    assert.match(recorded.message, /not copied/);
  }
  const push = decideServiceRequest({
    service: "push",
    choice: "fcm",
    confirm: true,
    supabaseStorage: "not_configured",
    firebaseStorage: "not_configured",
    measurementConfigured: false,
    fcmReady: false,
  });
  assert.equal(push.ok, false);
  const analytics = decideServiceRequest({
    service: "analytics",
    choice: "firebase_analytics",
    confirm: true,
    supabaseStorage: "not_configured",
    firebaseStorage: "not_configured",
    measurementConfigured: true,
    fcmReady: false,
  });
  assert.equal(analytics.ok, true);
  if (analytics.ok) assert.match(analytics.message, /still off/);
});

test("cloud board stays truthful and does not include a saved key", () => {
  const secret = `sb_publishable_${"b".repeat(24)}`;
  const board = buildCloudBoard({
    databaseLabel: "Embedded Postgres with this app's accounts",
    supabase: {
      fields: SUPABASE_FIELDS.map((field) => ({
        id: field.id,
        label: field.label,
        env: field.env,
        secret: field.secret,
        optional: false,
        present: true,
        hint: field.secret ? maskTail(secret) : "https://abcd.supabase.co",
        source: "saved" as const,
      })),
      capabilities: [
        { id: "project", label: "Project API", state: "connected", detail: "health ok", checkedAt: "2026-01-02T00:00:00.000Z" },
        { id: "storage", label: "Storage API", state: "needs_setup", detail: "policies", checkedAt: "" },
      ],
    },
    firebase: {
      fields: emptyFirebaseFields(),
      capabilities: [
        { id: "project", label: "Project config", state: "not_configured", detail: "", checkedAt: "" },
        { id: "storage", label: "Cloud Storage", state: "not_configured", detail: "", checkedAt: "" },
        { id: "messaging", label: "Cloud Messaging", state: "connected", detail: "should not stick", checkedAt: "" },
        { id: "analytics", label: "Analytics", state: "connected", detail: "should not stick", checkedAt: "" },
      ],
      vapid: false,
    },
    requests: [],
  });
  const json = JSON.stringify(board);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes("sb_publishable_"), false);
  assert.equal(board.services[0].locked, true);
  assert.equal(board.services[0].active, "Embedded Postgres with this app's accounts");
  assert.equal(board.services[1].active, "This app's library");
  assert.equal(board.services[1].choices.find((choice) => choice.id === "supabase_storage")?.allowed, false);
  assert.equal(board.services[2].choices.find((choice) => choice.id === "fcm")?.allowed, false);
  assert.equal(board.services[3].active, "Off");
  assert.equal(board.providers[1].capabilities.find((item) => item.id === "messaging")?.state, "not_configured");
  assert.equal(board.providers[1].capabilities.find((item) => item.id === "analytics")?.state, "not_configured");
  assert.equal(board.providers[0].label, "Connected");
  assert.match(board.providers[0].secretNote, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("apply refuses core migration and activates storage only after a passed probe", () => {
  const moved = decideCloudApply({
    service: "records",
    choice: "firebase",
    confirm: true,
    serviceAccount: true,
    storageProbe: "passed",
    fcmServerReady: true,
    measurementConfigured: true,
    consentAcknowledged: true,
  });
  assert.equal(moved.ok, false);
  const early = decideCloudApply({
    service: "media",
    choice: "firebase_storage",
    confirm: true,
    serviceAccount: false,
    storageProbe: "failed",
    fcmServerReady: false,
    measurementConfigured: false,
    consentAcknowledged: false,
  });
  assert.equal(early.ok, false);
  if (!early.ok) assert.match(early.error, /library stays active/);
  const applied = decideCloudApply({
    service: "media",
    choice: "firebase_storage",
    confirm: true,
    serviceAccount: true,
    storageProbe: "passed",
    fcmServerReady: false,
    measurementConfigured: false,
    consentAcknowledged: false,
  });
  assert.equal(applied.ok, true);
  if (applied.ok) assert.match(applied.message, /already in this app's library/);
  const quiet = decideCloudApply({
    service: "analytics",
    choice: "firebase_analytics",
    confirm: true,
    serviceAccount: false,
    storageProbe: "skipped",
    fcmServerReady: false,
    measurementConfigured: true,
    consentAcknowledged: false,
  });
  assert.equal(quiet.ok, false);
});

test("supabase probe and public runtime do not leak privileged values", () => {
  const marker = "priv-marker-should-not-appear";
  const missing = interpretSupabaseProbe({ code: "PGRST205", message: `missing table ${marker}` }, [marker]);
  assert.equal(missing.state, "connected");
  assert.equal(missing.detail.includes(marker), false);
  const account = parseServiceAccount(`{"type":"not-an-account","private_key":"${marker}"}`);
  assert.equal(account.ok, false);
  if (!account.ok) assert.equal(account.error.includes(marker), false);
  const quiet = publicRuntimeView({
    analytics: false,
    push: "inbox",
    web: { apiKey: "AIzaSyA1234567890123456789012", authDomain: "app.firebaseapp.com", projectId: "wedding-circle", messagingSenderId: "123456789", appId: "1:123456789:web:abcdef", measurementId: "G-ABC123" },
    vapid: marker,
  });
  assert.equal(JSON.stringify(quiet).includes("AIza"), false);
  assert.equal(JSON.stringify(quiet).includes(marker), false);
});

test("supabase form status separates saved config from a verified connection", () => {
  assert.equal(supabaseFormStatus({ configured: false, dirty: false, saving: false, projectState: "not_configured" }).label, "Not configured");
  assert.equal(supabaseFormStatus({ configured: false, dirty: true, saving: false, projectState: "not_configured" }).label, "Unsaved changes");
  assert.equal(supabaseFormStatus({ configured: true, dirty: true, saving: true, projectState: "not_configured" }).label, "Saving");
  assert.equal(supabaseFormStatus({ configured: true, dirty: false, saving: false, projectState: "not_configured" }).label, "Saved");
  assert.equal(supabaseFormStatus({ configured: true, dirty: false, saving: false, projectState: "connected" }).label, "Connection verified");
  assert.equal(supabaseFormStatus({ configured: true, dirty: false, saving: false, projectState: "error" }).label, "Connection failed");
});

test("the Supabase Data API diagnostic uses a publishable key on a zero-row resource", async (context) => {
  const { probeSupabaseDataApi } = await import("./control/supabase-api.ts");
  const project = "https://exampleproject.supabase.co";
  const key = "sb_publishable_test";
  const providerResponses = [
    () => Response.json({ code: "PGRST205", message: "Missing probe resource" }, { status: 404 }),
    () => Response.json({ code: "PGRST302", message: key }, { status: 401 }),
    () => Response.json({ code: "PGRST205" }, { status: 403 }),
    () => Response.json({ message: key }, { status: 404 }),
    () => Response.json([]),
  ];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, project);
    assert.match(url.pathname, /^\/rest\/v1\/wc_api_probe_reserved_missing$/);
    assert.equal(url.searchParams.get("limit"), "0");
    assert.equal(init?.redirect, "manual");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), key);
    assert.equal(headers.has("authorization"), false);
    return providerResponses.shift()!();
  });

  assert.equal((await probeSupabaseDataApi(project, key)).ok, true);
  const restricted = await probeSupabaseDataApi(project, key);
  assert.equal(restricted.ok, false);
  assert.match(restricted.message, /HTTP 401, PGRST302/);
  assert.doesNotMatch(restricted.message, /sb_publishable/);
  assert.equal((await probeSupabaseDataApi(project, key)).ok, false);
  assert.equal((await probeSupabaseDataApi(project, key)).ok, false);
  assert.equal((await probeSupabaseDataApi(project, key)).ok, true);
});
