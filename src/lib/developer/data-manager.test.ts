import assert from "node:assert/strict";
import test from "node:test";
import {
  activateDecision,
  explainFailure,
  looksLikeSecretPaste,
  productionRoutes,
  redactSecrets,
  resumeDecision,
  saveConnectionDecision,
  syncDecision,
  transferDecision,
} from "./data-manager.ts";

const base = {
  production: true,
  neonConfigured: true,
  neonVerified: true,
  supabaseConfigured: true,
  supabaseVerified: true,
  supabaseAuth: "ok" as const,
  cutover: "neon" as const,
  phase: "idle",
  observedRoute: null,
  mediaActive: "library" as const,
  firebaseStorageVerified: null,
};

test("a successful Supabase connection is not treated as the live wedding database", () => {
  const routes = productionRoutes({ ...base, observedRoute: null, cutover: "neon" });
  const wedding = routes.rows.find((row) => row.id === "wedding_core");
  assert.equal(routes.live, "unknown");
  assert.match(wedding?.serving || "", /Unknown/);
  assert.doesNotMatch(wedding?.serving || "", /Supabase Postgres/);
  const accounts = routes.rows.find((row) => row.id === "accounts");
  assert.match(accounts?.configured || "", /Better Auth/);
  assert.doesNotMatch(accounts?.configured || "", /Firebase/);
});

test("Supabase is serving only after a request in this process was observed", () => {
  const unseen = productionRoutes({ ...base, cutover: "supabase", supabaseVerified: true, observedRoute: null });
  assert.equal(unseen.live, "unknown");
  const seen = productionRoutes({ ...base, cutover: "supabase", supabaseVerified: true, observedRoute: "supabase" });
  assert.equal(seen.live, "supabase");
  assert.equal(seen.rows.find((row) => row.id === "wedding_core")?.serving, "Supabase Postgres");
  const failed = productionRoutes({ ...base, cutover: "supabase", supabaseVerified: false, observedRoute: null });
  assert.match(failed.rows.find((row) => row.id === "wedding_core")?.serving || "", /not used in its place/);
});

test("preview does not claim published routing and Firebase is not the wedding database", () => {
  const preview = productionRoutes({ ...base, production: false });
  assert.equal(preview.live, "preview");
  assert.match(preview.rows.find((row) => row.id === "wedding_core")?.serving || "", /not the published site/);
  const media = productionRoutes({ ...base, mediaActive: "firebase", firebaseStorageVerified: false });
  assert.match(media.rows.find((row) => row.id === "media")?.serving || "", /not verified/);
  assert.match(String(transferDecision({
    source: "firebase",
    destination: "supabase",
    execute: true,
    confirm: true,
    productionSource: true,
    extras: 0,
    conflicts: 0,
    missing: 0,
  }).error), /not the wedding database/);
});

test("save rejects privileged values and does not change routing", () => {
  assert.equal(looksLikeSecretPaste("postgresql://user:secret@host/db"), true);
  assert.equal(looksLikeSecretPaste("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"), true);
  const refused = saveConnectionDecision({ provider: "supabase", pasted: "postgresql://user:secret@host/db", confirm: true });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.error, /SUPABASE_DB_URL/);
  assert.match(redactSecrets(refused.ok ? "" : refused.error + " postgresql://user:secret@host/db"), /postgresql:\/\/••••/);
  assert.doesNotMatch(redactSecrets("postgresql://user:secret@host/db"), /secret@host/);
  const neon = saveConnectionDecision({ provider: "neon", pasted: "", confirm: true });
  assert.equal(neon.ok, true);
  if (neon.ok) assert.match(neon.message, /DATABASE_URL/);
  assert.equal(saveConnectionDecision({ provider: "firebase", pasted: "", confirm: false }).ok, false);
});

test("transfer keeps destination-only rows and activation stays blocked", () => {
  const preview = transferDecision({
    source: "neon",
    destination: "supabase",
    execute: false,
    confirm: false,
    productionSource: true,
    extras: 5,
    conflicts: 6,
    missing: 0,
  });
  assert.equal(preview.mode, "preview");
  const local = transferDecision({
    source: "neon",
    destination: "supabase",
    execute: true,
    confirm: true,
    productionSource: false,
    extras: 0,
    conflicts: 0,
    missing: 0,
  });
  assert.equal(local.ok, false);
  const copy = transferDecision({
    source: "neon",
    destination: "supabase",
    execute: true,
    confirm: true,
    productionSource: true,
    extras: 5,
    conflicts: 6,
    missing: 1,
  });
  assert.equal(copy.mode, "copy");
  if (copy.ok) assert.match(copy.error, /kept/);
  const activation = activateDecision({
    confirm: true,
    auditOk: false,
    extras: 5,
    conflicts: 6,
    missing: 1,
    publicClosed: true,
    serverAccessOk: true,
    orphanInvites: 0,
    duplicateIds: 0,
  });
  assert.equal(activation.ok, false);
  assert.equal(activateDecision({
    confirm: true,
    auditOk: true,
    extras: 0,
    conflicts: 0,
    missing: 0,
    publicClosed: false,
    serverAccessOk: true,
    orphanInvites: 0,
    duplicateIds: 0,
  }).ok, false);
  assert.equal(activateDecision({
    confirm: false,
    auditOk: true,
    extras: 0,
    conflicts: 0,
    missing: 0,
    publicClosed: true,
    serverAccessOk: true,
    orphanInvites: 0,
    duplicateIds: 0,
  }).ok, false);
});

test("sync will not overwrite a live Supabase writer and resume is bounded", () => {
  assert.equal(syncDecision({ confirm: true, live: "supabase", phase: "cutover", productionSource: true }).ok, false);
  assert.equal(syncDecision({ confirm: true, live: "unknown", phase: "idle", productionSource: true }).ok, false);
  assert.equal(syncDecision({ confirm: true, live: "preview", phase: "idle", productionSource: false }).ok, false);
  assert.equal(syncDecision({ confirm: true, live: "neon", phase: "idle", productionSource: true }).ok, true);
  assert.equal(resumeDecision("syncing", 10_000).ok, false);
  assert.equal(resumeDecision("syncing", 120_000).ok, true);
  assert.equal(resumeDecision("idle", 120_000).ok, false);
});

test("diagnostics remove secrets and say when nothing changed", () => {
  const diagnostic = explainFailure({
    action: "Test connection",
    provider: "Supabase Postgres",
    code: "28P01",
    message: "password authentication failed for postgresql://postgres:hunter2@aws-0.pooler.supabase.com:5432/postgres",
    changed: false,
  });
  assert.equal(diagnostic.retrySafe, false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /hunter2/);
  assert.match(diagnostic.changed, /not switched|no rows were deleted/i);
  assert.match(diagnostic.where, /Supabase Postgres/);
});
