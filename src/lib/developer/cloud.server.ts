import { getSql, type Sql } from "@/lib/db";
import { serverEnvironment } from "@/lib/env.server";
import { FIREBASE_FIELDS, SUPABASE_FIELDS, cleanSupabaseInput, looksPrivileged, maskTail, publicRuntimeView, type CapabilityState, type FieldView } from "@/lib/developer/cloud";
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

async function supabaseRaw() {
  const runtime = await serverEnvironment();
  const projectUrl = runtime.SUPABASE_URL?.trim() || "";
  const publishableKey = runtime.SUPABASE_PUBLISHABLE_KEY?.trim() || runtime.SUPABASE_ANON_KEY?.trim() || "";
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
  const fromEnv = await supabaseRaw();
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

type ProbeResult = { state: CapabilityState; detail: string; checks?: { id: string; label: string; ok: boolean }[] };

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
    const runtime = await serverEnvironment();
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
      vapid: runtime.FIREBASE_VAPID_KEY || "",
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

