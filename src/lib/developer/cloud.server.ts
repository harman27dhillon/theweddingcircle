import { randomBytes } from "node:crypto";
import { dbSource, getSql, type Sql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { env } from "@/lib/env.server";
import {
  FIREBASE_FIELDS,
  SUPABASE_FIELDS,
  analyticsReport,
  buildCloudBoard,
  cleanFirebaseInput,
  cleanSupabaseInput,
  decideCloudApply,
  decideServiceRequest,
  fcmReport,
  interpretFirebaseProject,
  interpretFirebaseStorage,
  interpretSupabaseProbe,
  interpretSupabaseStorage,
  firebaseProjectNumber,
  looksPrivileged,
  maskTail,
  parseServiceAccount,
  publicRuntimeView,
  redactCloud,
  type CapabilityState,
  type CapabilityView,
  type CloudProviderId,
  type FieldView,
} from "@/lib/developer/cloud";
import { readFirebaseWebConfig } from "@/lib/wedding/firebase-web.server";

const lastTest = new Map<string, number>();

const SUPABASE_CAPS = [
  ["project", "Project API"],
  ["storage", "Storage API"],
] as const;

const FIREBASE_CAPS = [
  ["project", "Project config"],
  ["storage", "Cloud Storage"],
  ["messaging", "Cloud Messaging"],
  ["analytics", "Analytics"],
] as const;

function databaseLabel() {
  if (dbSource === "supabase") return "Supabase Postgres";
  return dbSource === "neon" ? "Neon Postgres with this app's accounts" : "Embedded Postgres with this app's accounts";
}

async function serviceAccountConfigured() {
  try {
    return parseServiceAccount((await readFirebaseWebConfig()).serviceAccountJson).ok;
  } catch {
    return false;
  }
}

function vapidReady() {
  const value = env("FIREBASE_VAPID_KEY") || "";
  return /^[A-Za-z0-9_-]{20,200}$/.test(value) && !looksPrivileged(value);
}

async function ensure(sql: Sql) {
  await sql`create table if not exists developer_cloud_public (
    provider text primary key,
    config jsonb not null,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists developer_cloud_tests (
    provider text not null,
    capability text not null,
    state text not null,
    detail text not null default '',
    checked_at timestamptz not null default now(),
    primary key (provider, capability)
  )`;
  await sql`create table if not exists developer_cloud_requests (
    service text primary key,
    choice text not null,
    note text not null default '',
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists developer_cloud_active (
    service text primary key,
    choice text not null,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
}

function asRecord(value: unknown) {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!raw || typeof raw !== "object") return {} as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function safeParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stamp(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function audit(email: string, command: string, result: string) {
  const sql = await getSql();
  await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${randomBytes(16).toString("hex")}, ${email}, ${command.slice(0, 500)}, ${"Cloud connections"}, ${"yellow"}, ${"cloud"}, ${result.slice(0, 500)})`;
}

async function readSaved(sql: Sql, provider: string) {
  const rows = await sql<{ config: unknown; updated_at: unknown }>`select config, updated_at from developer_cloud_public where provider = ${provider} limit 1`;
  return { config: asRecord(rows[0]?.config), updatedAt: stamp(rows[0]?.updated_at) };
}

function fieldView(id: string, label: string, envName: string, secret: boolean, optional: boolean, value: string, source: FieldView["source"]): FieldView {
  const present = Boolean(value);
  return {
    id,
    label,
    env: envName,
    secret,
    optional,
    present,
    hint: !present ? "" : secret ? maskTail(value) : value,
    source: present ? source : "none",
  };
}

function supabaseRaw() {
  const projectUrl = env("SUPABASE_URL") || "";
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || "";
  return { projectUrl, publishableKey };
}

async function resolveFirebase(_sql: Sql) {
  const resolved = await readFirebaseWebConfig();
  const source = resolved.present ? "environment" : "none";
  const invalidEnv = [
    resolved.incomplete ? "Server environment values for Firebase were refused. Use the web app config, not a service-account private key." : "",
    resolved.note,
  ].filter(Boolean).join(" ");
  return {
    raw: resolved.raw,
    envLocked: resolved.present,
    invalidEnv,
    fields: FIREBASE_FIELDS.map((field) => fieldView(field.id, field.label, field.env, field.secret, "optional" in field && field.optional === true, resolved.raw[field.id] || "", source)),
  };
}

async function resolveSupabase(sql: Sql) {
  const fromEnv = supabaseRaw();
  const envComplete = Boolean(fromEnv.projectUrl && fromEnv.publishableKey);
  const cleanEnv = envComplete ? cleanSupabaseInput(fromEnv) : null;
  if (cleanEnv?.ok) {
    return {
      raw: cleanEnv.fields as Record<string, string>,
      envLocked: true,
      invalidEnv: "",
      savedAt: "",
      fields: SUPABASE_FIELDS.map((field) => fieldView(field.id, field.label, field.env, field.secret, false, cleanEnv.fields[field.id] || "", "environment")),
    };
  }
  const saved = await readSaved(sql, "supabase");
  const clean = saved.config.projectUrl || saved.config.publishableKey ? cleanSupabaseInput(saved.config) : null;
  const raw: Record<string, string> = clean?.ok ? clean.fields : {};
  const invalidEnv = envComplete && !cleanEnv?.ok
    ? "Server environment values for Supabase were refused. Check SUPABASE_URL and the publishable key. A service-role key must not be used as the publishable key. The form can still save a valid public pair."
    : fromEnv.projectUrl || fromEnv.publishableKey
      ? "The server environment has only part of the Supabase public config, so it is not used. Save both the project URL and the publishable key here, or set both variables."
      : "";
  return {
    raw,
    envLocked: false,
    invalidEnv,
    savedAt: clean?.ok ? saved.updatedAt : "",
    fields: SUPABASE_FIELDS.map((field) => fieldView(field.id, field.label, field.env, field.secret, false, raw[field.id] || "", "saved")),
  };
}

export async function activeSupabasePublic() {
  const sql = await getSql();
  await ensure(sql);
  const resolved = await resolveSupabase(sql);
  return { projectUrl: resolved.raw.projectUrl || "", publishableKey: resolved.raw.publishableKey || "" };
}

async function readTests(sql: Sql, provider: string, catalog: readonly (readonly [string, string])[]) {
  const rows = await sql<{ capability: string; state: string; detail: string; checked_at: unknown }>`
    select capability, state, detail, checked_at from developer_cloud_tests where provider = ${provider}
  `;
  const byId = new Map(rows.map((row) => [row.capability, row]));
  return catalog.map(([id, label]): CapabilityView => {
    const row = byId.get(id);
    const state = row?.state;
    const known: CapabilityState[] = ["not_configured", "needs_setup", "connected", "error"];
    return {
      id,
      label,
      state: known.includes(state as CapabilityState) ? (state as CapabilityState) : "not_configured",
      detail: redactCloud(row?.detail || "", []),
      checkedAt: stamp(row?.checked_at),
    };
  });
}

async function remember(sql: Sql, provider: string, capability: string, state: string, detail: string) {
  const safe = redactCloud(detail, []);
  await sql`insert into developer_cloud_tests (provider, capability, state, detail, checked_at)
    values (${provider}, ${capability}, ${state}, ${safe}, now())
    on conflict (provider, capability) do update set state = excluded.state, detail = excluded.detail, checked_at = now()`;
}

export async function cloudBoard(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  try {
    return { ...(await persistedCloudBoard()), persisted: true as const };
  } catch {
    const publicSupabase = cleanSupabaseInput(supabaseRaw());
    const publicFirebase = cleanFirebaseInput(firebaseRawFromEnv());
    const supabase: Record<string, string> = publicSupabase.ok ? publicSupabase.fields : {};
    const firebase: Record<string, string> = publicFirebase.ok ? publicFirebase.fields : {};
    const board = buildCloudBoard({
      databaseLabel: `${databaseLabel()} (unavailable)`,
      supabase: {
        fields: SUPABASE_FIELDS.map((field) => fieldView(field.id, field.label, field.env, field.secret, false, supabase[field.id] || "", "environment")),
        capabilities: [],
        savedAt: "",
      },
      firebase: {
        fields: FIREBASE_FIELDS.map((field) => fieldView(field.id, field.label, field.env, field.secret, "optional" in field && field.optional === true, firebase[field.id] || "", "environment")),
        capabilities: [],
        vapid: Boolean(env("FIREBASE_VAPID_KEY")),
        serviceAccount: serviceAccountConfigured(),
      },
      requests: [],
      actives: { media: "", push: "", analytics: "" },
      worker: true,
      fcmReady: false,
    });
    return {
      ...board,
      persisted: false as const,
      note: "The database is unavailable. This page shows server configuration only. Saved settings and connection history are unavailable.",
    };
  }
}

async function persistedCloudBoard() {
  const sql = await getSql();
  await ensure(sql);
  const supabase = await resolveSupabase(sql);
  const firebase = await resolveFirebase(sql);
  const requests = await sql<{ service: string; choice: string; note: string; updated_at: unknown }>`
    select service, choice, note, updated_at from developer_cloud_requests
  `;
  const actives = await sql<{ service: string; choice: string }>`select service, choice from developer_cloud_active`;
  const activeMap = Object.fromEntries(actives.map((row) => [row.service, row.choice]));
  const sender = Boolean(firebase.fields.find((field) => field.id === "messagingSenderId")?.present);
  const appId = Boolean(firebase.fields.find((field) => field.id === "appId")?.present);
  const serviceAccount = await serviceAccountConfigured();
  const board = buildCloudBoard({
    databaseLabel: databaseLabel(),
    supabase: { fields: supabase.fields, capabilities: await readTests(sql, "supabase", SUPABASE_CAPS), savedAt: supabase.savedAt },
    firebase: { fields: firebase.fields, capabilities: await readTests(sql, "firebase", FIREBASE_CAPS), vapid: Boolean(env("FIREBASE_VAPID_KEY")), serviceAccount },
    requests: requests.map((row) => ({ service: row.service, choice: row.choice, note: redactCloud(row.note || "", []), updatedAt: stamp(row.updated_at) })),
    actives: { media: activeMap.media || "", push: activeMap.push || "", analytics: activeMap.analytics || "" },
    worker: true,
    fcmReady: sender && appId && Boolean(env("FIREBASE_VAPID_KEY")) && serviceAccount,
  });
  if (supabase.invalidEnv) board.providers[0].guidance = supabase.invalidEnv;
  else if (supabase.envLocked && !board.providers[0].configured) {
    board.providers[0].guidance = "Supabase environment variables are set, but the public URL and publishable key are not both usable. Finish them in the server environment. This form will not store a second copy, and a service-role key is not accepted.";
  }
  if (firebase.invalidEnv) board.providers[1].guidance = firebase.invalidEnv;
  else if (firebase.envLocked && !board.providers[1].configured) {
    board.providers[1].guidance = "Some Firebase environment variables are set, but the web config is incomplete or was refused. Set the web fields in the server environment. Do not put a service-account private key in FIREBASE_API_KEY.";
  }
  return board;
}

function providerOf(value: string): CloudProviderId | null {
  return value === "supabase" || value === "firebase" ? value : null;
}

export async function saveCloud(token: string, providerId: string, input: Record<string, unknown>, confirm: boolean, confirmReplace: boolean, expectedUpdatedAt = "") {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const provider = providerOf(providerId);
  if (!provider) return { ok: false as const, error: "That provider is not part of Cloud Connections." };
  if (!confirm) return { ok: false as const, error: "Confirm before saving. Nothing was stored." };
  const sql = await getSql();
  await ensure(sql);
  const current = provider === "supabase" ? await resolveSupabase(sql) : await resolveFirebase(sql);
  if (current.envLocked) {
    const names = (provider === "supabase" ? SUPABASE_FIELDS : FIREBASE_FIELDS).map((field) => field.env).join(", ");
    return { ok: false as const, error: `Nothing was written. ${names} are already set in the server environment, so this form will not store a second copy.` };
  }
  const existing = await readSaved(sql, provider);
  const merged: Record<string, unknown> = { ...input };
  if (provider === "supabase") {
    if (!String(merged.projectUrl || "").trim() && existing.config.projectUrl) merged.projectUrl = existing.config.projectUrl;
    if (!String(merged.publishableKey || "").trim() && existing.config.publishableKey) merged.publishableKey = existing.config.publishableKey;
  }
  const clean = provider === "supabase" ? cleanSupabaseInput(merged) : cleanFirebaseInput(merged);
  if (!clean.ok) return clean;
  if (Object.keys(existing.config).length > 0 && !confirmReplace) {
    return { ok: false as const, error: "Confirm that you want to replace the saved public configuration. Nothing was changed." };
  }
  if (expectedUpdatedAt && existing.updatedAt && expectedUpdatedAt !== existing.updatedAt) {
    return { ok: false as const, error: "A newer configuration was saved. Refresh the status before replacing it. Nothing was changed." };
  }
  await sql`insert into developer_cloud_public (provider, config, updated_by, updated_at)
    values (${provider}, ${JSON.stringify(clean.fields)}::jsonb, ${session.email}, now())
    on conflict (provider) do update set config = excluded.config, updated_by = excluded.updated_by, updated_at = now()`;
  await sql`delete from developer_cloud_tests where provider = ${provider}`;
  const stored = await readSaved(sql, provider);
  await audit(session.email, `Save ${provider} public config`, "Public configuration replaced. The key was not returned.");
  return {
    ok: true as const,
    saved: true as const,
    savedAt: stored.updatedAt,
    message: provider === "supabase"
      ? "Project URL and publishable key were saved on the server. The key stays masked. This does not set the database password."
      : "Public configuration saved on the server. The values are masked on the next load. No service was switched, and no privileged key was stored.",
  };
}

async function probe(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  const body = (await response.text()).slice(0, 500);
  return { status: response.status, body };
}

export async function testCloud(token: string, providerId: string, capability: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const provider = providerOf(providerId);
  if (!provider) return { ok: false as const, error: "That provider is not part of Cloud Connections." };
  const allowed = provider === "supabase" ? ["project", "storage"] : ["project", "storage", "messaging", "analytics"];
  if (!allowed.includes(capability)) return { ok: false as const, error: "That check is not available for this provider." };
  const recent = lastTest.get(`${provider}:${capability}`) ?? 0;
  if (Date.now() - recent < 15_000) return { ok: false as const, error: "Wait a moment before testing this connection again." };
  lastTest.set(`${provider}:${capability}`, Date.now());
  const sql = await getSql();
  await ensure(sql);
  const resolved = provider === "supabase" ? await resolveSupabase(sql) : await resolveFirebase(sql);
  if (provider === "supabase" && (!resolved.raw.projectUrl || !resolved.raw.publishableKey)) {
    return { ok: true as const, state: "not_configured" as const, detail: "Not configured. Add the project URL and publishable key before testing. No request was sent." };
  }
  if (provider === "firebase" && !resolved.raw.apiKey) {
    return { ok: true as const, state: "not_configured" as const, detail: "Not configured. Add the Firebase web config before testing. No request was sent." };
  }
  try {
    const result = provider === "supabase" ? await testSupabase(resolved.raw, capability) : await testFirebase(resolved.raw, capability);
    await remember(sql, provider, capability, result.state, result.detail);
    await audit(session.email, `Test ${provider} ${capability}`, result.state);
    return { ok: true as const, state: result.state, detail: result.detail, checks: result.checks };
  } catch {
    const detail = "The connection test could not reach the provider. Check the project address and API restrictions. Nothing was switched.";
    await remember(sql, provider, capability, "error", detail);
    return { ok: true as const, state: "error" as const, detail };
  }
}

type ProbeResult = { state: CapabilityState; detail: string; checks?: { id: string; label: string; ok: boolean }[] };

async function testSupabase(raw: Record<string, string>, capability: string): Promise<ProbeResult> {
  const origin = raw.projectUrl;
  const key = raw.publishableKey;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (capability === "storage") {
    const response = await probe(`${origin}/storage/v1/bucket`, { headers });
    return interpretSupabaseStorage(response.status, response.body, [key, origin]);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.from("wc_connection_probe").select("id").limit(1);
  return interpretSupabaseProbe(error ? { message: error.message, code: error.code } : null, [key]);
}

async function testFirebase(raw: Record<string, string>, capability: string): Promise<ProbeResult> {
  const secrets = Object.values(raw);
  if (capability === "storage") {
    if (!raw.storageBucket) return { state: "needs_setup" as const, detail: "Add storageBucket only if Cloud Storage should be tested. Media was not switched." };
    const response = await probe(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(raw.storageBucket)}/o?maxResults=1&key=${encodeURIComponent(raw.apiKey)}`, {});
    return interpretFirebaseStorage(response.status);
  }
  if (capability === "messaging") {
    const report = fcmReport({
      sender: Boolean(raw.messagingSenderId),
      appId: Boolean(raw.appId),
      vapid: Boolean(env("FIREBASE_VAPID_KEY")),
      worker: true,
      serviceAccount: await serviceAccountConfigured(),
    });
    return report;
  }
  if (capability === "analytics") return analyticsReport(raw.measurementId || "");
  const response = await probe(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(raw.apiKey)}`, {});
  return interpretFirebaseProject(response.status, response.body, raw.projectId || "", secrets, raw.authDomain || "", firebaseProjectNumber(raw.appId || "", raw.messagingSenderId || ""));
}

export async function requestCloud(token: string, service: string, choice: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await getSql();
  await ensure(sql);
  const supabaseTests = await readTests(sql, "supabase", SUPABASE_CAPS);
  const firebaseTests = await readTests(sql, "firebase", FIREBASE_CAPS);
  const firebase = await resolveFirebase(sql);
  const decision = decideServiceRequest({
    service,
    choice,
    confirm,
    supabaseStorage: supabaseTests.find((item) => item.id === "storage")?.state ?? "not_configured",
    firebaseStorage: firebaseTests.find((item) => item.id === "storage")?.state ?? "not_configured",
    measurementConfigured: Boolean(firebase.raw.measurementId),
    fcmReady: Boolean(firebase.raw.messagingSenderId && firebase.raw.appId && vapidReady() && await serviceAccountConfigured()),
  });
  if (!decision.ok) return decision;
  if (decision.choice === "current" || decision.choice === "off") {
    await sql`delete from developer_cloud_requests where service = ${service}`;
  } else {
    await sql`insert into developer_cloud_requests (service, choice, note, updated_by, updated_at)
      values (${service}, ${decision.choice}, ${decision.message}, ${session.email}, now())
      on conflict (service) do update set choice = excluded.choice, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`;
  }
  await audit(session.email, `Cloud request ${service} ${decision.choice}`, "Active provider unchanged.");
  return { ok: true as const, message: decision.message };
}

export async function disconnectCloud(token: string, providerId: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const provider = providerOf(providerId);
  if (!provider) return { ok: false as const, error: "That provider is not part of Cloud Connections." };
  if (!confirm) return { ok: false as const, error: "Confirm before disconnecting. Nothing was changed." };
  const sql = await getSql();
  await ensure(sql);
  const resolved = provider === "supabase" ? await resolveSupabase(sql) : await resolveFirebase(sql);
  await sql`delete from developer_cloud_public where provider = ${provider}`;
  await sql`delete from developer_cloud_tests where provider = ${provider}`;
  if (provider === "supabase") await sql`delete from developer_cloud_requests where choice = ${"supabase_storage"}`;
  if (provider === "firebase") await sql`delete from developer_cloud_requests where choice in ('firebase_storage', 'fcm', 'firebase_analytics')`;
  if (provider === "firebase") {
    await sql`update developer_cloud_active set choice = ${"library"}, updated_by = ${session.email}, updated_at = now() where service = ${"media"} and choice = ${"firebase_storage"}`;
    await sql`update developer_cloud_active set choice = ${"inbox"}, updated_by = ${session.email}, updated_at = now() where service = ${"push"} and choice = ${"fcm"}`;
    await sql`update developer_cloud_active set choice = ${"off"}, updated_by = ${session.email}, updated_at = now() where service = ${"analytics"} and choice = ${"firebase_analytics"}`;
  }
  await audit(session.email, `Disconnect ${provider} public config`, "Saved public copy removed. Wedding data was not deleted.");
  if (resolved.envLocked) {
    const names = (provider === "supabase" ? ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] : FIREBASE_FIELDS.map((field) => field.env)).join(", ");
    return { ok: true as const, message: `Removed any saved public copy. ${names} are still set in the server environment, so remove those variables to finish disconnecting. Wedding records and files were not deleted.` };
  }
  return { ok: true as const, message: "Disconnected the saved public configuration. Wedding records, memberships, media and accounts were not deleted." };
}

export async function applyCloud(token: string, service: string, choice: string, confirm: boolean, consent: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Confirm before applying. The current provider stays active." };
  const sql = await getSql();
  await ensure(sql);
  const firebase = await resolveFirebase(sql);
  let storageProbe: "passed" | "failed" | "skipped" = "skipped";
  if (service === "media" && choice === "firebase_storage") {
    const { probeFirebaseStorage } = await import("@/lib/developer/firebase-storage.server");
    const probe = await probeFirebaseStorage();
    storageProbe = probe.ok ? "passed" : "failed";
    if (!probe.ok) return { ok: false as const, error: probe.detail };
  }
  let fcmServerReady = false;
  if (service === "push" && choice === "fcm") {
    const { firebaseSenderReady } = await import("@/lib/developer/firebase-storage.server");
    fcmServerReady = Boolean(firebase.raw.messagingSenderId && firebase.raw.appId && vapidReady() && (await firebaseSenderReady()));
  }
  const decision = decideCloudApply({
    service,
    choice,
    confirm,
    serviceAccount: await serviceAccountConfigured(),
    storageProbe,
    fcmServerReady,
    measurementConfigured: Boolean(firebase.raw.measurementId),
    consentAcknowledged: consent,
  });
  if (!decision.ok) return decision;
  await sql`insert into developer_cloud_active (service, choice, updated_by, updated_at)
    values (${service}, ${decision.active}, ${session.email}, now())
    on conflict (service) do update set choice = excluded.choice, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(session.email, `Apply cloud ${service} ${decision.active}`, "Prior wedding records were not migrated.");
  return { ok: true as const, message: decision.message };
}

export async function cloudPublicRuntime() {
  const quiet = { analytics: false as const, push: "inbox" as const };
  try {
    const sql = await getSql();
    await ensure(sql);
    const rows = await sql<{ service: string; choice: string }>`select service, choice from developer_cloud_active`;
    const active = Object.fromEntries(rows.map((row) => [row.service, row.choice]));
    const analytics = active.analytics === "firebase_analytics";
    const push = active.push === "fcm" ? "fcm" as const : "inbox" as const;
    if (!analytics && push !== "fcm") return quiet;
    const firebase = await resolveFirebase(sql);
    return publicRuntimeView({
      analytics,
      push,
      web: firebase.raw.apiKey
        ? {
            apiKey: firebase.raw.apiKey,
            authDomain: firebase.raw.authDomain || "",
            projectId: firebase.raw.projectId || "",
            messagingSenderId: firebase.raw.messagingSenderId || "",
            appId: firebase.raw.appId || "",
            measurementId: firebase.raw.measurementId || "",
          }
        : null,
      vapid: env("FIREBASE_VAPID_KEY") || "",
    });
  } catch {
    return quiet;
  }
}

export async function savePushDevice(deviceSecret: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(deviceSecret) || token.length < 20 || token.length > 4096 || looksPrivileged(token)) {
    return { ok: false as const, error: "That notification setup was not accepted." };
  }
  const sql = await getSql();
  await ensure(sql);
  const active = (await sql<{ choice: string }>`select choice from developer_cloud_active where service = ${"push"} limit 1`)[0];
  if (active?.choice !== "fcm") return { ok: false as const, error: "Push notifications stay in the app." };
  const { createHash } = await import("node:crypto");
  const owner = createHash("sha256").update(deviceSecret).digest("hex");
  await sql`create table if not exists push_devices (
    owner_hash text primary key,
    token text not null,
    updated_at timestamptz not null default now()
  )`;
  await sql`insert into push_devices (owner_hash, token, updated_at)
    values (${owner}, ${token}, now())
    on conflict (owner_hash) do update set token = excluded.token, updated_at = now()`;
  return { ok: true as const };
}

