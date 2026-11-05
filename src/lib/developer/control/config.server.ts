import { parse } from "pg-connection-string";
import { CONFIG_FIELDS, type ConfigDraft, type ConfigName, type Diagnostic } from "./model";
import { safeSupabaseUri } from "../supabase-connect";

const prefix = "WC_DEVELOPER_";
const secret = (name: ConfigName) => process.env[prefix + name]?.trim() || "";

export function readControlConfig() {
  return Object.fromEntries(CONFIG_FIELDS.map(({ name }) => [name, secret(name)])) as Record<ConfigName, string>;
}

export function projectUrl(value: string) {
  return /^https:\/\/[a-z0-9]{8,64}\.supabase\.co\/?$/i.test(value) ? value.replace(/\/$/, "").toLowerCase() : "";
}

export function validateDatabaseUrl(value: string, project: string) {
  const shape = safeSupabaseUri(value);
  if (shape.status !== "ready") return "Enter a valid single-line Supabase Postgres URL with its password percent-encoded.";
  const direct = /^db\.([a-z0-9]{8,64})\.supabase\.co$/.exec(shape.host);
  const pool = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(shape.host);
  if ((!direct && !pool) || shape.port !== 5432) return "Use the Supabase direct or session pooler endpoint on port 5432.";
  const ref = /^https:\/\/([a-z0-9]{8,64})\.supabase\.co$/i.exec(project)?.[1];
  const user = parse(value).user || "";
  const selected = direct?.[1] || /^postgres\.([a-z0-9]{8,64})$/.exec(user)?.[1];
  if (!selected || (ref && ref !== selected)) return "The Postgres endpoint and Supabase project URL must identify the same project.";
  return "";
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

function secretWriter() {
  const account = process.env.DEVELOPER_CLOUDFLARE_ACCOUNT_ID?.trim();
  const worker = process.env.DEVELOPER_CLOUDFLARE_WORKER_NAME?.trim();
  const token = process.env.DEVELOPER_CLOUDFLARE_API_TOKEN?.trim();
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !worker || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(worker) || !token) return null;
  return { account, worker, token };
}

export async function configurationStatus() {
  const config = readControlConfig();
  // Cloudflare supplies this module in the Worker runtime. A normal Node
  // process has no binding; it never reads process.env.HYPERDRIVE.
  let cloudflare = false;
  let hyperdrive = false;
  try {
    const runtime = await import("cloudflare:workers");
    cloudflare = true;
    hyperdrive = typeof runtime.env.HYPERDRIVE?.connectionString === "string";
  } catch { /* non-Worker runtime */ }
  return {
    configured: Object.fromEntries(CONFIG_FIELDS.map(({ name }) => [name, Boolean(config[name])])) as Record<ConfigName, boolean>,
    databaseConfigured: Boolean(config.SUPABASE_DB_URL),
    cloudflare,
    hyperdrive,
    canStage: Boolean(secretWriter()),
  };
}

export async function stageConfiguration(draft: ConfigDraft, clear: boolean): Promise<Diagnostic> {
  const writer = secretWriter();
  if (!writer) return { ok: false, message: "Cloudflare secret management is not configured. Add the Developer Center Worker secrets through Cloudflare." };
  const current = readControlConfig();
  const project = projectUrl(draft.SUPABASE_URL || current.SUPABASE_URL);
  const secrets: Record<string, { name: string; type: "secret_text"; text: string } | null> = {};
  for (const { name } of CONFIG_FIELDS) {
    const key = prefix + name;
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
  const config = readControlConfig();
  const url = projectUrl(config.SUPABASE_URL);
  const key = config.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: false, message: "Configure the Supabase project URL and publishable key first." };
  if (validate("SUPABASE_PUBLISHABLE_KEY", key, url)) return { ok: false, message: "The configured key is not a Supabase publishable key." };
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) return { ok: false, message: "Supabase reached, but it refused the publishable key or API access." };
    if (!response.ok) return { ok: false, message: `The Supabase API answered with HTTP ${response.status}.` };
    return { ok: true, message: "Supabase accepted the publishable key. This checks HTTPS API access only.", checkedAt: new Date().toISOString() };
  } catch {
    return { ok: false, message: "The Supabase HTTPS API could not be reached." };
  }
}
