import { parseServiceAccount } from "../cloud";
import { bareCloudflareToken } from "../../infra/config";
import { cdnProbeToken, cleanCdnInput, combineCdnStatus, judgeCdnProbe, judgeZoneCheck } from "../../infra/cdn";
import { probeMediaGateway } from "../../infra/gateway-probe";
import { googleToken } from "../../infra/infra.server";
import { infraVaultKey, resolvedInfraEnv } from "../../infra/resolved-env.server";
import { normalizeGatewayOrigin } from "../../infra/media-token";
import { hyperdriveConnectionString, serverEnvironment } from "../../env.server";
import { classifyRealtimeProbe, cloudflareFailure, judgeWebinarPresets, PRESENTER_PRESET, readPresetList, readPresetPermission, REALTIME_API, VIEWER_PRESET } from "../../infra/realtime";
import { realtimeAuthorizationHeader } from "../../infra/live";
import { probeR2Bucket } from "../../infra/r2-sign";
import { testSupabaseApi } from "./config.server";
import type { Diagnostic, InfrastructureCheck } from "./model";

type RuntimeEnv = Record<string, string | undefined>;
const value = (env: RuntimeEnv, key: string) => env[key]?.trim() || "";

function verdict(result: { usable: boolean; detail: string; requirement: string }): Diagnostic {
  return { ok: result.usable, message: result.detail, details: result.requirement ? [result.requirement] : undefined };
}

async function firebase(env: RuntimeEnv): Promise<Diagnostic> {
  const raw = value(env, "FIREBASE_SERVICE_ACCOUNT_JSON");
  const account = parseServiceAccount(raw);
  if (!account.ok) return { ok: false, message: "FIREBASE_SERVICE_ACCOUNT_JSON is missing or unreadable." };
  const project = value(env, "FIREBASE_PROJECT_ID") || account.projectId;
  if (project !== account.projectId) return { ok: false, message: "FIREBASE_PROJECT_ID and the service account JSON identify different projects." };
  const token = await googleToken(raw, "https://www.googleapis.com/auth/firebase.readonly");
  if (!token.ok) return { ok: false, message: token.error };
  const response = await fetch(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(project)}`, {
    headers: { authorization: `Bearer ${token.token}` }, redirect: "manual", signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null) as { projectId?: string } | null;
  if (!response.ok) return { ok: false, message: `Google issued a service account token, but the Firebase project read returned HTTP ${response.status}.` };
  if (body?.projectId !== project) return { ok: false, message: "Firebase did not confirm the expected project." };
  return { ok: true, message: "Firebase confirmed project access for the service account. Sign-in, storage rules and push delivery are separate checks." };
}

async function r2(env: RuntimeEnv, saved: RuntimeEnv): Promise<Diagnostic> {
  const keys = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
  const missing = keys.filter((key) => !value(env, key));
  if (missing.length) return { ok: false, message: `Missing R2 settings. Set ${missing.join(", ")}.` };
  const worker = await serverEnvironment();
  const overrides = keys.filter((key) => value(saved, key) && value(worker, key) && value(saved, key) !== value(worker, key));
  const result = await probeR2Bucket({
    accountId: value(env, keys[0]), bucket: value(env, keys[1]), accessKeyId: value(env, keys[2]),
    secretAccessKey: value(env, keys[3]), jurisdiction: value(env, "R2_JURISDICTION"),
  });
  return {
    ok: result.ok, message: result.detail,
    details: overrides.length ? [`Worker values override saved app settings for ${overrides.join(", ")}. This test uses the same settings as uploads.`] : undefined,
  };
}

function gateway(env: RuntimeEnv) {
  return probeMediaGateway({
    enabled: value(env, "MEDIA_GATEWAY_ENABLED") === "yes",
    origin: value(env, "MEDIA_GATEWAY_ORIGIN"),
    secret: value(env, "MEDIA_GATEWAY_SECRET"),
  });
}

async function cdn(env: RuntimeEnv): Promise<Diagnostic> {
  const config = {
    enabled: value(env, "CDN_ENABLED") === "yes",
    domain: value(env, "CDN_MEDIA_DOMAIN"),
    base: value(env, "CDN_BASE_URL"),
    cache: value(env, "CDN_CACHE_POLICY"),
    zoneId: value(env, "CDN_ZONE_ID") || value(env, "CLOUDFLARE_ZONE_ID"),
    token: value(env, "CDN_API_TOKEN"),
  };
  const gatewayOrigin = normalizeGatewayOrigin(value(env, "MEDIA_GATEWAY_ORIGIN"));
  if (!config.enabled) return { ok: false, message: "Private CDN delivery is disabled. Set CDN_ENABLED to yes to configure this check." };
  const clean = cleanCdnInput(config);
  if (!clean.ok) return { ok: false, message: clean.error };

  const secret = infraVaultKey();
  const url = `${clean.base}/api/infra/cdn-probe`;
  async function request(token?: string) {
    try {
      const response = await fetch(url, {
        headers: token ? { "x-wc-cdn-probe": token } : undefined,
        redirect: "manual", signal: AbortSignal.timeout(8_000),
      });
      const cache = response.headers.get("cache-control")?.toLowerCase().split(",").map((part) => part.trim()) || [];
      const privateResponse = cache.includes("private") && cache.includes("no-store") &&
        !cache.some((part) => part === "public" || part.startsWith("s-maxage")) &&
        response.headers.get("x-wc-private") === "1" &&
        response.headers.get("cf-cache-status")?.toLowerCase() !== "hit";
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, privateResponse };
    } catch {
      return { status: null, privateResponse: false };
    }
  }

  const [anonymous, signed, zone] = await Promise.all([
    clean.base === gatewayOrigin ? null : request(),
    clean.base !== gatewayOrigin && secret ? request(cdnProbeToken(secret)) : null,
    cdnZone(clean),
  ]);
  const result = clean.base === gatewayOrigin
    ? await gateway(env)
    : judgeCdnProbe({
        enabled: true, domain: clean.domain, dnsOk: Boolean(anonymous?.status || signed?.status),
        anonymousStatus: anonymous?.status ?? null, authedStatus: signed?.status ?? null,
        authedPrivate: signed?.privateResponse ?? false, probeSigned: Boolean(secret),
      });
  const checked = combineCdnStatus(result, zone);
  if (checked.usable) return { ok: true, message: "The media host rejected unsigned access and returned private headers for a signed probe.", details: zone ? [zone.detail] : undefined };
  return verdict(checked);
}

async function cdnZone(config: { domain: string; token: string; zoneId: string }) {
  if (!config.token && !config.zoneId) return null;
  if (!config.token || !config.zoneId) return { checked: true, ok: false, kind: "configuration", detail: "Set both CDN_API_TOKEN and CDN_ZONE_ID to check Cloudflare zone access." };
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}`, {
      headers: { authorization: `Bearer ${config.token}` }, redirect: "manual", signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => null) as { success?: boolean; result?: { name?: string } } | null;
    return { checked: true, ...judgeZoneCheck({ status: response.status, success: body?.success === true, zoneName: body?.result?.name || "", domain: config.domain, note: "" }) };
  } catch {
    return { checked: true, ok: false, kind: "configuration", detail: "Cloudflare's zone API did not respond." };
  }
}

async function stream(env: RuntimeEnv): Promise<Diagnostic> {
  const account = value(env, "CLOUDFLARE_ACCOUNT_ID");
  const token = bareCloudflareToken(value(env, "CLOUDFLARE_STREAM_API_TOKEN"));
  if (!/^[a-f0-9]{32}$/i.test(account) || !token) return { ok: false, message: "Stream requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN." };
  const response = await fetch(`${REALTIME_API}/accounts/${account}/stream/live_inputs`, {
    headers: { authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => null) as { success?: boolean } | null;
  return response.ok && body?.success === true
    ? { ok: true, message: "Cloudflare Stream accepted a read of live inputs." }
    : { ok: false, message: `Cloudflare did not confirm Stream access (HTTP ${response.status}). Check the account and Stream token permissions.` };
}

async function realtime(env: RuntimeEnv): Promise<Diagnostic> {
  const account = value(env, "CLOUDFLARE_ACCOUNT_ID");
  const app = value(env, "CLOUDFLARE_REALTIME_APP_ID");
  const authorization = realtimeAuthorizationHeader(value(env, "CLOUDFLARE_REALTIME_API_TOKEN"));
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-z0-9-]{1,64}$/i.test(app) || !authorization) {
    return { ok: false, message: "RealtimeKit requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_REALTIME_APP_ID and CLOUDFLARE_REALTIME_API_TOKEN." };
  }
  const url = `${REALTIME_API}/accounts/${account}/realtime/kit/${app}/presets`;
  async function read(path: string) {
    const response = await fetch(url + path, { headers: { authorization }, redirect: "manual", signal: AbortSignal.timeout(8_000) });
    const body = await response.json().catch(() => null) as { success?: boolean } | null;
    return { status: response.status, ok: response.ok && body?.success === true, body };
  }
  async function permissions(name: string) {
    const list = await read(`?search=${encodeURIComponent(name)}`);
    const preset = list.ok && readPresetList(list.body).find((item) => item.name === name);
    if (!preset) return { ...list, permission: null };
    const result = await read(`/${encodeURIComponent(preset.id)}`);
    return { ...result, permission: result.ok ? readPresetPermission(result.body, name) : null };
  }
  const [presenter, viewer] = await Promise.all([permissions(PRESENTER_PRESET), permissions(VIEWER_PRESET)]);
  const failed = [presenter, viewer].find((result) => !result.ok);
  const result = failed
    ? classifyRealtimeProbe({ status: failed.status, code: cloudflareFailure(failed.body).code, note: "" })
    : judgeWebinarPresets(presenter.permission, viewer.permission);
  return { ok: result.ok, message: result.detail };
}

async function hyperdrive(): Promise<Diagnostic> {
  const connectionString = await hyperdriveConnectionString();
  if (!connectionString) return { ok: false, message: "This deployment has no HYPERDRIVE binding." };
  const { Client } = await import("pg");
  const client = new Client({ connectionString, connectionTimeoutMillis: 8_000, query_timeout: 8_000 });
  try {
    await client.connect();
    const result = await client.query<{ reachable: number }>("select 1 as reachable");
    return result.rows[0]?.reachable === 1
      ? { ok: true, message: "Hyperdrive connected and ran a read-only Postgres query." }
      : { ok: false, message: "Hyperdrive returned an unexpected result for its Postgres query." };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function infrastructureStatus() {
  const [{ env }, binding] = await Promise.all([resolvedInfraEnv(true), hyperdriveConnectionString()]);
  const hyperdrive = Boolean(binding);
  const present = (key: string) => Boolean(env[key]?.trim());
  return {
    firebase: ["FIREBASE_PROJECT_ID", "FIREBASE_SERVICE_ACCOUNT_JSON"].every(present),
    r2: ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every(present),
    cdn: env.CDN_ENABLED?.trim() === "yes" && present("CDN_MEDIA_DOMAIN") && present("CDN_BASE_URL"),
    stream: present("CLOUDFLARE_ACCOUNT_ID") && present("CLOUDFLARE_STREAM_API_TOKEN"),
    realtimekit: present("CLOUDFLARE_ACCOUNT_ID") && present("CLOUDFLARE_REALTIME_APP_ID") && present("CLOUDFLARE_REALTIME_API_TOKEN"),
    gateway: env.MEDIA_GATEWAY_ENABLED?.trim() === "yes" && present("MEDIA_GATEWAY_ORIGIN") && present("MEDIA_GATEWAY_SECRET"),
    hyperdrive,
    supabase: present("SUPABASE_URL") && (present("SUPABASE_PUBLISHABLE_KEY") || present("SUPABASE_ANON_KEY")),
  };
}

export async function runInfrastructureDiagnostic(check: InfrastructureCheck): Promise<Diagnostic> {
  try {
    if (check === "supabase") return await testSupabaseApi();
    if (check === "hyperdrive") return await hyperdrive();
    const { env, saved } = await resolvedInfraEnv(true);
    switch (check) {
      case "firebase": return await firebase(env);
      case "r2": return await r2(env, saved);
      case "gateway": return verdict(await gateway(env));
      case "cdn": return await cdn(env);
      case "stream": return await stream(env);
      case "realtimekit": return await realtime(env);
    }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, message: timeout ? "The provider did not respond before the check timed out." : "The connection check could not complete on this Worker." };
  }
}
