import { probeSupabaseDataApi } from "./supabase-api";
import { CONFIG_FIELDS, type ConfigDraft, type ConfigName, type Diagnostic } from "./model";
import { validateDatabaseUrl } from "../supabase-connect";
import { env, hyperdriveConnectionString, serverEnvironment, workerEnvironment } from "@/lib/env.server";

import { STAGING_SUPABASE_URL } from "../supabase-projects";

const prefix = "WC_DEVELOPER_";
// Cloudflare Worker variables are the source of truth. The prefixed names remain
// as a compatibility fallback for previously staged Developer Center values.
const secret = (name: ConfigName, environment: Record<string, string | undefined>) => {
  // Supabase project URL and publishable key use their standard Worker names.
  if (name === "SUPABASE_URL" || name === "SUPABASE_PUBLISHABLE_KEY") {
    return environment[name]?.trim() || (name === "SUPABASE_PUBLISHABLE_KEY" ? environment.SUPABASE_ANON_KEY?.trim() : "") || "";
  }
  return environment[name]?.trim() || environment[prefix + name]?.trim() || "";
};

export function readControlConfig(environment: Record<string, string | undefined> = process.env) {
  return Object.fromEntries(CONFIG_FIELDS.map(({ name }) => [name, secret(name, environment)])) as Record<ConfigName, string>;
}

export function projectUrl(value: string) {
  return /^https:\/\/[a-z0-9]{8,64}\.supabase\.co\/?$/i.test(value) ? value.replace(/\/$/, "").toLowerCase() : "";
}


function validate(name: ConfigName, value: string, project: string) {
  if (name === "SUPABASE_URL") return projectUrl(value) ? "" : "Use the HTTPS project URL from Supabase.";
  if (name === "SUPABASE_DB_URL") return validateDatabaseUrl(value, project);
  if (name === "SUPABASE_PUBLISHABLE_KEY" && /^sb_publishable_[a-z0-9_-]+$/i.test(value)) return "";
  if (name === "SUPABASE_SERVICE_ROLE_KEY" && /^sb_secret_[a-z0-9_-]+$/i.test(value)) return "";
  try {
    const role = JSON.parse(Buffer.from(value.split(".")[1] || "", "base64url").toString()).role;
    if (role === (name === "SUPABASE_PUBLISHABLE_KEY" ? "anon" : "service_role") && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return "";
  } catch { /* report a generic validation error */ }
  return "Use the matching key type from the Supabase dashboard.";
}

function secretWriter(environment: Record<string, string | undefined>) {
  const account = environment.DEVELOPER_CLOUDFLARE_ACCOUNT_ID?.trim();
  const worker = environment.DEVELOPER_CLOUDFLARE_WORKER_NAME?.trim();
  const token = environment.DEVELOPER_CLOUDFLARE_API_TOKEN?.trim();
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !worker || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(worker) || !token) return null;
  return { account, worker, token };
}

export async function configurationStatus() {
  const environment = await serverEnvironment();
  const config = readControlConfig(environment);
  const cloudflare = Boolean(workerEnvironment());
  const hyperdrive = Boolean(await hyperdriveConnectionString());
  const staging = env("APP_ENV") === "staging";
  const databaseConfigured = staging
    ? Boolean(config.SUPABASE_DB_URL) && !validateDatabaseUrl(config.SUPABASE_DB_URL, STAGING_SUPABASE_URL)
    : Boolean(config.SUPABASE_DB_URL) || hyperdrive;
  return {
    environment: staging ? "staging" as const : "production" as const,
    projectUrl: projectUrl(config.SUPABASE_URL),
    configured: Object.fromEntries(CONFIG_FIELDS.map(({ name }) => [name, Boolean(config[name])])) as Record<ConfigName, boolean>,
    databaseConfigured,
    cloudflare,
    hyperdrive,
    canStage: !staging && Boolean(secretWriter(environment)),
  };
}

export async function stageConfiguration(draft: ConfigDraft, clear: boolean): Promise<Diagnostic> {
  if (env("APP_ENV") === "staging") {
    return { ok: false, message: "Manage staging secrets in Cloudflare’s staging Preview settings." };
  }
  const environment = await serverEnvironment();
  const writer = secretWriter(environment);
  if (!writer) return { ok: false, message: "Cloudflare secret management is not configured. Add the Developer Center Worker secrets through Cloudflare." };
  const current = readControlConfig(environment);
  const project = projectUrl(draft.SUPABASE_URL || current.SUPABASE_URL);
  const secrets: Record<string, { name: string; type: "secret_text"; text: string } | null> = {};
  for (const { name } of CONFIG_FIELDS) {
    const key = name === "SUPABASE_URL" || name === "SUPABASE_PUBLISHABLE_KEY" ? name : prefix + name;
    const value = draft[name];
    if (clear) secrets[key] = null;
    else if (value) {
      const error = validate(name, value, project);
      if (error) return { ok: false, message: `${name}: ${error}` };
      secrets[key] = { name: key, type: "secret_text", text: value };
    }
  }
  if (!Object.keys(secrets).length) return { ok: false, message: "Enter at least one value to save. Blank fields leave current secrets in place." };
  const database = draft.SUPABASE_DB_URL || current.SUPABASE_DB_URL;
  if (!clear && database && project) {
    const error = validateDatabaseUrl(database, project);
    if (error) return { ok: false, message: error };
  }
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${writer.account}/workers/scripts/${writer.worker}/secrets-bulk`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${writer.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ secrets }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json() as { success?: boolean };
    if (!response.ok || !body.success) return { ok: false, message: `Cloudflare refused the configuration change (HTTP ${response.status}). Verify the Worker name and token permissions.` };
    return {
      ok: true,
      message: clear ? "Cloudflare staged removal of the Developer Center secrets." : "Cloudflare staged the Developer Center secrets.",
      details: ["Review and deploy the staged version in Cloudflare before testing its settings."],
    };
  } catch {
    return { ok: false, message: "The Cloudflare secret request did not finish. Check Worker Versions before retrying." };
  }
}

export async function testSupabaseApi(): Promise<Diagnostic> {
  const config = readControlConfig(await serverEnvironment());
  const url = projectUrl(config.SUPABASE_URL);
  const key = config.SUPABASE_PUBLISHABLE_KEY;
  if (env("APP_ENV") === "staging" && url !== STAGING_SUPABASE_URL) {
    return { ok: false, message: "SUPABASE_URL must identify the staging Supabase project." };
  }
  if (!url || !key) return { ok: false, message: `Set SUPABASE_URL to this deployment’s Supabase project URL and set the matching SUPABASE_PUBLISHABLE_KEY on this Worker.` };
  if (validate("SUPABASE_PUBLISHABLE_KEY", key, url)) return { ok: false, message: "The configured key is not a Supabase publishable or legacy anon key." };
  return probeSupabaseDataApi(url, key);
}
