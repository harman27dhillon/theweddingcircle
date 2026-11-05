import { testSupabaseApi } from "./config.server";
import { probeR2Bucket } from "@/lib/infra/r2-sign";
import { serviceAccountJwt } from "@/lib/infra/google-jwt";
import { parseServiceAccount } from "../cloud";

export type InfrastructureId = "firebase" | "r2" | "cdn" | "stream" | "gateway" | "hyperdrive" | "supabase";
export type InfrastructureDiagnostic = { ok: boolean; message: string; details?: string[]; checkedAt?: string };

const checked = (ok: boolean, message: string, details?: string[]): InfrastructureDiagnostic =>
  ({ ok, message, ...(details?.length ? { details } : {}), checkedAt: new Date().toISOString() });

export async function infrastructureStatus() {
  const { env } = await (await import("@/lib/infra/resolved-env.server")).resolvedInfraEnv();
  let hyperdrive = false;
  try {
    const runtime = await import("cloudflare:workers");
    hyperdrive = Boolean(runtime.env.HYPERDRIVE?.connectionString);
  } catch {}
  const present = (key: string) => Boolean(env[key]?.trim());
  return {
    firebase: ["FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT_JSON"].every(present),
    r2: ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every(present),
    cdn: env.CDN_ENABLED?.trim() === "yes" && present("CDN_MEDIA_DOMAIN") && present("CDN_BASE_URL"),
    stream: present("CLOUDFLARE_ACCOUNT_ID") && present("CLOUDFLARE_REALTIME_APP_ID") && present("CLOUDFLARE_REALTIME_API_TOKEN"),
    gateway: env.MEDIA_GATEWAY_ENABLED?.trim() === "yes" && present("MEDIA_GATEWAY_ORIGIN") && present("MEDIA_GATEWAY_SECRET"),
    hyperdrive,
    supabase: present("SUPABASE_URL") && (present("SUPABASE_PUBLISHABLE_KEY") || present("SUPABASE_ANON_KEY")),
  };
}

export async function runInfrastructureDiagnostic(id: InfrastructureId): Promise<InfrastructureDiagnostic> {
  const { env } = await (await import("@/lib/infra/resolved-env.server")).resolvedInfraEnv();
  try {
    if (id === "supabase") return testSupabaseApi(env);
    if (id === "hyperdrive") {
      const runtime = await import("cloudflare:workers");
      const connectionString = runtime.env.HYPERDRIVE?.connectionString;
      if (!connectionString) return checked(false, "The HYPERDRIVE binding is not available in this Worker runtime.");
      const { Client } = await import("pg");
      const client = new Client({ connectionString, connectionTimeoutMillis: 8000, query_timeout: 8000 });
      try {
        await client.connect();
        await client.query("select 1");
        return checked(true, "Hyperdrive connected to PostgreSQL and returned select 1. No records were read or changed.");
      } finally { await client.end().catch(() => undefined); }
    }
    if (id === "r2") {
      const input = { accountId: env.R2_ACCOUNT_ID || "", bucket: env.R2_BUCKET || "", accessKeyId: env.R2_ACCESS_KEY_ID || "", secretAccessKey: env.R2_SECRET_ACCESS_KEY || "" };
      if (Object.values(input).some((value) => !value)) return checked(false, "R2 configuration is incomplete. Required Worker values are R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.");
      const result = await probeR2Bucket(input);
      return checked(result.ok, result.detail);
    }
    if (id === "firebase") {
      const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
      const account = parseServiceAccount(raw);
      if (!account.ok) return checked(false, account.error);
      if (!env.FIREBASE_API_KEY || !env.FIREBASE_PROJECT_ID) return checked(false, "Firebase web API key or project id is missing.");
      try {
        const assertion = serviceAccountJwt({ clientEmail: account.clientEmail, privateKey: account.privateKey }, "https://www.googleapis.com/auth/cloud-platform", Date.now());
        const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(10000) });
        const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string };
        if (!response.ok || !body.access_token) return checked(false, `Google rejected the Firebase service account${body.error ? ` (${body.error})` : ""}. Check project and IAM permissions.`);
        return checked(true, "Google accepted the Firebase service account and issued an access token. The token was discarded; no Firebase data was changed.");
      } catch { return checked(false, "Firebase service-account verification could not complete. Check the private key and Worker network access."); }
    }
    if (id === "gateway") {
      const origin = (env.MEDIA_GATEWAY_ORIGIN || "").trim().replace(/\/$/, "");
      if (String(env.MEDIA_GATEWAY_ENABLED || "").trim() !== "yes" || !origin || !env.MEDIA_GATEWAY_SECRET) return checked(false, "Media Gateway is not fully configured/enabled in the existing Infrastructure settings. Existing private media delivery was not changed.");
      let url: URL;
      try { url = new URL(origin); } catch { return checked(false, "Media Gateway origin is not a valid URL."); }
      if (url.protocol !== "https:") return checked(false, "Media Gateway must use HTTPS.");
      try {
        const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
        return checked(true, `Media Gateway host responded with HTTP ${response.status}. This confirms reachability only, not signed-media authorization.`);
      } catch { return checked(false, "Media Gateway origin could not be reached. Check its hostname and Worker route."); }
    }
    if (id === "stream") {
      const configured = Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_REALTIME_APP_ID && env.CLOUDFLARE_REALTIME_API_TOKEN);
      if (!configured) return checked(false, "RealtimeKit requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_API_TOKEN. The legacy Stream token is not used for this check.");
      return checked(false, "RealtimeKit credentials are present, but this panel does not yet perform the preset/role capability test. No meeting was created.");
    }
    if (id === "cdn") {
      const host = env.CDN_BASE_URL || "";
      if (!host) return checked(false, "No CDN delivery hostname is configured. The private R2 bucket and Media Gateway remain unchanged.");
      return checked(false, "A CDN hostname is configured, but a private-media cache validation is not implemented here. No cache policy was changed.");
    }
    return checked(false, "Unknown infrastructure service.");
  } catch {
    return checked(false, "The diagnostic could not complete. No secret values are included in this report.");
  }
}
