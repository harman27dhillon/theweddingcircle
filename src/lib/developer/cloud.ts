export const SUPABASE_FIELDS = [
  { id: "projectUrl", label: "Project URL", env: "SUPABASE_URL", secret: false },
  { id: "publishableKey", label: "Publishable key", env: "SUPABASE_PUBLISHABLE_KEY", secret: true },
] as const;

export const FIREBASE_FIELDS = [
  { id: "apiKey", label: "apiKey", env: "FIREBASE_API_KEY", secret: true },
  { id: "authDomain", label: "authDomain", env: "FIREBASE_AUTH_DOMAIN", secret: false },
  { id: "projectId", label: "projectId", env: "FIREBASE_PROJECT_ID", secret: false },
  { id: "storageBucket", label: "storageBucket (only if Storage is used)", env: "FIREBASE_STORAGE_BUCKET", secret: false, optional: true },
  { id: "messagingSenderId", label: "messagingSenderId", env: "FIREBASE_MESSAGING_SENDER_ID", secret: false },
  { id: "appId", label: "appId", env: "FIREBASE_APP_ID", secret: false },
  { id: "measurementId", label: "measurementId (only if Analytics is used)", env: "FIREBASE_MEASUREMENT_ID", secret: false, optional: true },
] as const;

export const CLOUD_SECRET_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_VAPID_KEY",
] as const;

export type CapabilityState = "not_configured" | "needs_setup" | "connected" | "error";
export type CloudProviderId = "supabase" | "firebase";

const FIELD_MAX = 300;

export function maskTail(value: string) {
  const clean = value.trim();
  if (clean.length < 8) return "saved";
  return `••••${clean.slice(-4)}`;
}

export function redactCloud(message: string, secrets: string[]) {
  let next = message.replace(/[\r\n]+/g, " ").trim();
  const extras = secrets.filter((secret) => secret && secret.length >= 6).sort((a, b) => b.length - a.length);
  for (const secret of extras) next = next.split(secret).join("••••");
  next = next
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, "••••")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, "••••")
    .replace(/\bsb_(?:secret|publishable)_[0-9A-Za-z_-]+\b/g, "••••");
  return next.slice(0, 240);
}

export function looksPrivileged(value: string) {
  return /service_role|BEGIN [A-Z ]*PRIVATE KEY|private_key|service_account|sb_secret_/i.test(value);
}

function jwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
    const json = typeof Buffer !== "undefined" ? Buffer.from(pad, "base64").toString("utf8") : atob(pad);
    const parsed = JSON.parse(json) as { role?: unknown };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function httpsOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
  if (url.pathname !== "/" && url.pathname !== "") return "";
  if (!url.hostname.includes(".")) return "";
  return url.origin;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanSupabaseInput(input: Record<string, unknown>) {
  const projectUrl = cleanText(input.projectUrl);
  const publishableKey = cleanText(input.publishableKey);
  if (looksPrivileged(projectUrl) || looksPrivileged(publishableKey)) {
    return { ok: false as const, error: "That value is a service-role or private key. It was not saved. Service-role keys belong in the server variable SUPABASE_SERVICE_ROLE_KEY, and this form never accepts them." };
  }
  const origin = httpsOrigin(projectUrl);
  if (!origin || origin.length > FIELD_MAX) {
    return { ok: false as const, error: "Project URL must be an https address with no path or password. Nothing was saved." };
  }
  const role = jwtPayload(publishableKey)?.role;
  const publishable = publishableKey.startsWith("sb_publishable_") && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey);
  const anonJwt = role === "anon" && publishableKey.length <= 2000;
  if (!publishable && !anonJwt) {
    return { ok: false as const, error: "Use the Supabase publishable or anon key. Service-role keys are refused. Nothing was saved." };
  }
  return { ok: true as const, fields: { projectUrl: origin, publishableKey } };
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function cleanFirebaseInput(input: Record<string, unknown>) {
  const apiKey = cleanText(input.apiKey);
  const authDomain = cleanText(input.authDomain).toLowerCase();
  const projectId = cleanText(input.projectId).toLowerCase();
  const storageBucket = cleanText(input.storageBucket).toLowerCase();
  const messagingSenderId = cleanText(input.messagingSenderId);
  const appId = cleanText(input.appId);
  const measurementId = cleanText(input.measurementId).toUpperCase();
  const joined = [apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId].join(" ");
  if (looksPrivileged(joined) || joined.includes("{")) {
    return { ok: false as const, error: "A private key or service-account file was refused. Paste the web app config fields only. Nothing was saved." };
  }
  if (!/^AIza[0-9A-Za-z_-]{20,180}$/.test(apiKey)) {
    return { ok: false as const, error: "apiKey is not a Firebase web API key. Nothing was saved." };
  }
  if (!HOST.test(authDomain)) return { ok: false as const, error: "authDomain is not a host name. Nothing was saved." };
  if (!/^[a-z0-9-]{4,40}$/.test(projectId)) return { ok: false as const, error: "projectId is not in the expected shape. Nothing was saved." };
  if (storageBucket && !HOST.test(storageBucket)) return { ok: false as const, error: "storageBucket is not a host name. Leave it empty unless Storage is selected. Nothing was saved." };
  if (!/^\d{6,22}$/.test(messagingSenderId)) return { ok: false as const, error: "messagingSenderId must be the numeric sender id. Nothing was saved." };
  if (!/^1:\d+:web:[a-zA-Z0-9]{4,64}$/.test(appId)) return { ok: false as const, error: "appId is not a Firebase web app id. Nothing was saved." };
  if (measurementId && !/^G-[A-Z0-9]{4,20}$/.test(measurementId)) {
    return { ok: false as const, error: "measurementId must look like a Google measurement id, or be left empty. Analytics stays off. Nothing was saved." };
  }
  const fields: Record<string, string> = { apiKey, authDomain, projectId, messagingSenderId, appId };
  if (storageBucket) fields.storageBucket = storageBucket;
  if (measurementId) fields.measurementId = measurementId;
  return { ok: true as const, fields };
}

export function interpretSupabaseHealth(status: number, body: string, secrets: string[]) {
  if (status === 200 && /version|GoTrue|name/i.test(body)) {
    return { state: "connected" as const, detail: "Supabase Auth health check succeeded. Wedding records were not read or moved. This does not prove Row Level Security." };
  }
  if (status === 401 || status === 403) {
    return { state: "error" as const, detail: "The publishable key was refused. Use the anon or publishable key. Do not paste a service-role key." };
  }
  const extra = redactCloud(body, secrets);
  return { state: "error" as const, detail: extra ? `Supabase health check failed (HTTP ${status}). ${extra}` : `Supabase health check failed (HTTP ${status}).` };
}

export function interpretSupabaseStorage(status: number, body: string, secrets: string[]) {
  if (status === 200) {
    return { state: "connected" as const, detail: "Supabase Storage responded to the publishable key. No wedding file was listed, copied, or deleted." };
  }
  if (status === 401 || status === 403) {
    return { state: "needs_setup" as const, detail: "Storage refused the publishable key. Create the bucket and policies in the Supabase dashboard. This form does not accept a service-role key, and media was not switched." };
  }
  const extra = redactCloud(body, secrets);
  return { state: "error" as const, detail: extra ? `Supabase Storage check failed (HTTP ${status}). ${extra}` : `Supabase Storage check failed (HTTP ${status}).` };
}

function firebaseProjectId(body: string) {
  try {
    const parsed = JSON.parse(body) as { projectId?: unknown; project_id?: unknown };
    const raw = parsed.projectId ?? parsed.project_id;
    const id = typeof raw === "number" && Number.isFinite(raw) ? String(Math.trunc(raw)) : typeof raw === "string" ? raw : "";
    return normalizeProjectId(id);
  } catch {
    return "";
  }
}

/** Digits from getProjectConfig are the GCP project number, never the project id slug. */
export function isFirebaseProjectNumber(value: string) {
  return /^\d+$/.test(value);
}

/** The web app id segment `1:{number}:web:` is the project number. The sender id is the same number when set. */
export function firebaseProjectNumber(appId: string, senderId = "") {
  const fromApp = /^1:(\d+):web:[a-zA-Z0-9]+$/.exec((appId || "").trim());
  if (fromApp) return fromApp[1];
  const sender = (senderId || "").trim();
  return /^\d+$/.test(sender) ? sender : "";
}

/** Email/Password is only read after the key check is accepted or explicitly deferred. An internal mismatch does not count as a provider check. */
export function firebaseKeyAllowsEmailProbe(state: string) {
  return state === "connected" || state === "needs_setup";
}

function authorizedDomains(body: string) {
  try {
    const parsed = JSON.parse(body) as { authorizedDomains?: unknown };
    if (!Array.isArray(parsed.authorizedDomains)) return null;
    return parsed.authorizedDomains.filter((item): item is string => typeof item === "string").map((item) => item.trim().toLowerCase());
  } catch {
    return null;
  }
}

function firebaseWebRefusal(body: string) {
  const text = body.toLowerCase();
  if (text.includes("api_key_http_referrer_blocked") || text.includes("requests from referer") || text.includes("requests from referrer")) return "referrer";
  if (text.includes("api_key_ip_address_blocked")) return "ip";
  if (text.includes("service_disabled") || text.includes("api has not been used") || text.includes("identity toolkit api has not been used")) return "disabled";
  return "";
}

export function normalizeProjectId(value: string) {
  return value.trim().replace(/^\uFEFF/, "").replace(/^["']+|["']+$/g, "").trim().toLowerCase();
}

export function firebaseWebAlignment(input: { projectId: string; authDomain: string; appId: string; senderId?: string }) {
  const projectId = normalizeProjectId(input.projectId);
  const authDomain = input.authDomain.trim().toLowerCase();
  const appId = input.appId.trim();
  const app = /^1:(\d+):web:[a-zA-Z0-9]+$/.exec(appId);
  if (!app) return { ok: false as const, detail: "FIREBASE_APP_ID is not a Firebase web app id. Nothing was switched." };
  if ((authDomain.endsWith(".firebaseapp.com") || authDomain.endsWith(".web.app")) && authDomain.split(".")[0] !== projectId) {
    return { ok: false as const, detail: `FIREBASE_AUTH_DOMAIN is ${authDomain}. FIREBASE_PROJECT_ID is ${projectId || "(empty)"}. A firebaseapp.com or web.app host must start with that project id. Nothing was switched.` };
  }
  const sender = (input.senderId || "").trim();
  if (sender && app[1] !== sender) return { ok: false as const, detail: `FIREBASE_APP_ID uses sender ${app[1]}. FIREBASE_MESSAGING_SENDER_ID is ${sender}. These fields are not one web app. Nothing was switched.` };
  return { ok: true as const };
}

export function interpretFirebaseProject(status: number, body: string, projectId: string, secrets: string[], authDomain = "", projectNumber = "") {
  // Inspect the complete response before shortening it. Never expose the raw body.
  const refusal = firebaseWebRefusal(body);
  const wanted = normalizeProjectId(projectId);
  void secrets;
  if (status === 200) {
    const id = firebaseProjectId(body);
    if (!wanted) {
      return { state: "error" as const, detail: "Internal check: Firebase answered, but no project id is saved to compare. Nothing was switched. Email/Password was not checked." };
    }
    if (!id) {
      return { state: "needs_setup" as const, detail: "Firebase accepted the web API key (HTTP 200), but the response did not include a project id. That is not a project mismatch. The service-account check still runs." };
    }
    const domains = authorizedDomains(body);
    const domain = authDomain.trim().toLowerCase();
    if (isFirebaseProjectNumber(id)) {
      const number = isFirebaseProjectNumber(projectNumber.trim()) ? projectNumber.trim() : "";
      if (number && number !== id) {
        return { state: "error" as const, detail: `Internal check: the web API key belongs to project number ${id}. The saved web app number is ${number}. These are different projects. Project id ${wanted} was not compared to that number. Nothing was switched. Email/Password was not checked.` };
      }
      const slugHosts = (domains || []).filter((item) => item.endsWith(".firebaseapp.com") || item.endsWith(".web.app")).map((item) => item.split(".")[0]);
      if (slugHosts.length > 0 && !slugHosts.includes(wanted)) {
        return { state: "error" as const, detail: `Internal check: the web API key's project number is ${id}. None of its Firebase hosts use project id ${wanted}. Nothing was switched. Email/Password was not checked.` };
      }
      const defaultHost = domain === `${wanted}.firebaseapp.com` || domain === `${wanted}.web.app`;
      if (domain && domains && domains.length > 0 && !domains.includes(domain) && !defaultHost) {
        return { state: "error" as const, detail: `Internal check: project number ${id} was not treated as a different project id. The auth domain ${domain} is not in that project's authorized domains. Nothing was switched. Email/Password was not checked.` };
      }
      const numberNote = number
        ? `Firebase accepted the web API key (HTTP 200). Project number ${id} matches the saved web app. Project id ${wanted} was checked separately and was not compared to that number.`
        : `Firebase accepted the web API key (HTTP 200). The response identified project number ${id}. It was not compared to project id ${wanted}.`;
      return { state: "connected" as const, detail: `${numberNote} Web config is not an authorization system. No data was migrated.` };
    }
    if (id !== wanted) {
      return { state: "error" as const, detail: `Internal check: the web API key belongs to project ${id}. The saved project id is ${wanted}. These are different projects. Nothing was switched. Email/Password was not checked.` };
    }
    const defaultHost = domain === `${wanted}.firebaseapp.com` || domain === `${wanted}.web.app`;
    if (domain && domains && domains.length > 0 && !domains.includes(domain) && !defaultHost) {
      return { state: "error" as const, detail: `Internal check: the saved project id ${wanted} matched the API key. The auth domain ${domain} is not in that project's authorized domains. Nothing was switched. Email/Password was not checked.` };
    }
    return { state: "connected" as const, detail: `Firebase accepted the web API key for project ${wanted}. Web config is not an authorization system. No data was migrated.` };
  }
  if (refusal === "referrer" || refusal === "ip") {
    return { state: "needs_setup" as const, detail: "The web API key is saved, but Google blocks server calls to it because of a browser or IP restriction. That does not mean the key is wrong. Server checks use the service account. Nothing was switched." };
  }
  if (refusal === "disabled") {
    return { state: "needs_setup" as const, detail: "The Identity Toolkit API is not enabled for this Google Cloud project. Enable identitytoolkit.googleapis.com, then run the test again. Nothing was switched." };
  }
  if (status === 400 || status === 401 || status === 403) {
    const messages: Record<string, string> = {
      API_KEY_INVALID:
        "Google reports an invalid web API key. Check FIREBASE_API_KEY against the Firebase web app configuration.",
      API_KEY_SERVICE_BLOCKED:
        "This key's API restrictions block the requested service. Check that Identity Toolkit is allowed. Firebase Authentication also needs Token Service API.",
      API_KEY_HTTP_REFERRER_BLOCKED:
        "Google blocked this server-side check because of the key's website restrictions. This does not prove browser sign-in is broken. Keep the restrictions; check Authentication using the service account.",
      API_KEY_IP_ADDRESS_BLOCKED:
        "Google blocked this server's IP address under the key's application restrictions.",
      SERVICE_DISABLED:
        "Google reports that the requested API is disabled. Check Identity Toolkit in this Firebase project's Google Cloud console.",
      PERMISSION_DENIED:
        "Google denied this configuration check. This response alone does not prove the web API key is invalid.",
      INVALID_ARGUMENT:
        "Google rejected a request parameter. Check the saved web configuration and the configuration-check request.",
      UNAUTHENTICATED:
        "Google could not authenticate this configuration-check request.",
    };
    let reason = "";
    try {
      const parsed = JSON.parse(body) as {
        error?: {
          status?: unknown;
          message?: unknown;
          details?: Array<{ reason?: unknown } | null>;
        };
      };
      const error = parsed.error;
      const candidates: unknown[] = [
        ...(Array.isArray(error?.details) ? error.details.map((item) => item?.reason) : []),
        error?.message,
        error?.status,
      ];
      reason = candidates.find((value): value is string => typeof value === "string" && Object.prototype.hasOwnProperty.call(messages, value)) || "";
    } catch {
      // Never expose unstructured provider responses.
    }
    const explanation = reason
      ? messages[reason]
      : "Google refused the configuration check without a recognized error code. The key has not been proven invalid.";
    return {
      state: "error" as const,
      detail: `Firebase configuration check failed (HTTP ${status}${reason ? `; ${reason}` : ""}). ${explanation} Email/Password was not checked.`,
    };
  }
  return { state: "error" as const, detail: `Google API error: Firebase project check failed (HTTP ${status}). Email/Password was not checked.` };
}

function googleErrorStatus(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown; errors?: { message?: unknown }[] } };
    const status = typeof parsed.error?.status === "string" ? parsed.error.status : "";
    if (/^[A-Z0-9_]+$/.test(status)) return status;
    const message = parsed.error?.errors?.find((item) => typeof item?.message === "string")?.message;
    if (typeof message === "string" && /^[A-Z0-9_]+$/.test(message)) return message;
  } catch {
    /* The body is not a Google error document. */
  }
  return "";
}

export type EmailPasswordMarker = "enabled" | "disabled" | "link" | "unread" | "permission" | "invalid" | "network";

/** Reads the Email/Password provider. Email link is not counted as password sign-in. A failed lookup is never disabled. */
export function interpretEmailPassword(status: number, body: string): { marker: EmailPasswordMarker; detail: string } {
  const code = googleErrorStatus(body);
  if (status === 200) {
    try {
      const parsed = JSON.parse(body) as { signIn?: { email?: { enabled?: unknown; passwordRequired?: unknown } }; config?: { signIn?: { email?: { enabled?: unknown; passwordRequired?: unknown } } } };
      const email = parsed.signIn?.email || parsed.config?.signIn?.email;
      if (!email || typeof email.enabled !== "boolean") {
        return { marker: "unread", detail: "Firebase answered, but signIn.email.enabled was not in the response. It was not marked disabled." };
      }
      if (email.enabled === true && email.passwordRequired === false) {
        return { marker: "link", detail: "Email link sign-in is enabled. Email/Password is not enabled. Nothing was changed in the Firebase Console." };
      }
      if (email.enabled === true) {
        return { marker: "enabled", detail: "Email/Password is enabled on this Firebase project. Email link was not counted as password sign-in. Nothing was changed in the Firebase Console." };
      }
      return { marker: "disabled", detail: "Email/Password is not enabled on this Firebase project. Nothing was changed in the Firebase Console." };
    } catch {
      return { marker: "unread", detail: "The Email/Password response could not be read. It was not marked disabled." };
    }
  }
  const suffix = code ? ` Google status ${code}.` : "";
  if (status === 401 || code === "UNAUTHENTICATED") {
    return { marker: "invalid", detail: `The Email/Password credentials were refused (HTTP ${status}).${suffix} The provider was not marked disabled.` };
  }
  if (status === 403 || code === "PERMISSION_DENIED") {
    return { marker: "permission", detail: `The service account is not allowed to read the Email/Password provider (HTTP ${status}).${suffix} That does not mean the provider is disabled.` };
  }
  if (status === 404) {
    return { marker: "unread", detail: `The Auth config for this project was not found (HTTP 404).${suffix} Email/Password was not marked disabled.` };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { marker: "network", detail: `The Email/Password provider could not be read because of an API or network failure (HTTP ${status}).${suffix} It was not marked disabled.` };
  }
  return { marker: "unread", detail: `The Email/Password provider could not be read (HTTP ${status}).${suffix} It was not marked disabled.` };
}

/** A failed password sign-in proves the provider is on. A disabled-provider code proves it is off. No account is created. */
export function interpretPasswordProbe(status: number, body: string): { marker: EmailPasswordMarker; detail: string } {
  const text = body.toLowerCase();
  if (text.includes("api_key_invalid") || text.includes("api key not valid")) {
    return { marker: "invalid", detail: "The Email/Password probe was refused because the web API key is not valid. The provider was not marked disabled." };
  }
  if (text.includes("api_key_http_referrer_blocked") || text.includes("api_key_ip_address_blocked")) {
    return { marker: "permission", detail: "The Email/Password probe was blocked by the web API key restriction. That does not mean the provider is disabled." };
  }
  if (text.includes("password_login_disabled") || (text.includes("operation_not_allowed") && text.includes("password"))) {
    return { marker: "disabled", detail: "Email/Password is not enabled on this Firebase project. Nothing was changed in the Firebase Console." };
  }
  if (text.includes("invalid_login_credentials") || text.includes("email_not_found") || text.includes("invalid_password") || text.includes("user_disabled") || text.includes("invalid_email")) {
    return { marker: "enabled", detail: "Email/Password is enabled. Firebase refused a sign-in for an unknown account, which is only possible when the password provider is on. No user was created." };
  }
  if (status === 401) {
    return { marker: "invalid", detail: "The Email/Password probe credentials were refused (HTTP 401). The provider was not marked disabled." };
  }
  if (status === 403) {
    return { marker: "permission", detail: "The Email/Password probe was not permitted (HTTP 403). The provider was not marked disabled." };
  }
  if (status === 408 || status === 429 || status >= 500 || status === 0) {
    return { marker: "network", detail: `The Email/Password probe could not reach Firebase (HTTP ${status}). It was not marked disabled.` };
  }
  return { marker: "unread", detail: `The Email/Password probe did not return a provider status (HTTP ${status}). It was not marked disabled.` };
}

/** Classifies a real Identity Toolkit sign-in response. It does not create an account. */
export function explainIdentityToolkitKey(status: number, body: string) {
  const text = body.replace(/AIza[0-9A-Za-z_-]{10,}/g, "••••").replace(/\s+/g, " ").trim().slice(0, 400);
  const lower = text.toLowerCase();
  if (lower.includes("api_key_invalid") || lower.includes("api key not valid")) {
    return { accepted: false as const, cause: "invalid-key" as const, detail: "Identity Toolkit rejected this key as invalid (API_KEY_INVALID). It was not used." };
  }
  if (lower.includes("api_key_http_referrer_blocked")) {
    return { accepted: false as const, cause: "referrer-restricted" as const, detail: "This key is restricted to browser referrers. Identity Toolkit rejected the server call because it has no matching referrer. The browser SDK and this server cannot share a referrer-only key." };
  }
  if (lower.includes("api_key_ip_address_blocked")) {
    return { accepted: false as const, cause: "ip-restricted" as const, detail: "This key is restricted by IP address. Identity Toolkit blocked the server call." };
  }
  if (lower.includes("api_key_service_blocked") || lower.includes("service_disabled") || lower.includes("identity toolkit api has not been used") || (lower.includes("identitytoolkit") && lower.includes("has not been used"))) {
    return { accepted: false as const, cause: "identity-toolkit-disabled" as const, detail: "The key reached Google, but the Identity Toolkit API is not enabled for its project." };
  }
  if (lower.includes("email_not_found") || lower.includes("invalid_password") || lower.includes("invalid_login_credentials") || lower.includes("user_disabled")) {
    return { accepted: true as const, cause: "key-accepted" as const, detail: "Identity Toolkit accepted the key. Email/Password refused an unknown account. No account was created." };
  }
  if (lower.includes("password_login_disabled") || (lower.includes("operation_not_allowed") && lower.includes("password"))) {
    return { accepted: true as const, cause: "password-provider-off" as const, detail: "Identity Toolkit accepted the key, but Email/Password sign-in is disabled on that project. No account was created." };
  }
  return { accepted: false as const, cause: "unclassified" as const, detail: `Identity Toolkit returned HTTP ${status}. ${text.slice(0, 180)}`.trim() };
}

/** Browser and Identity Toolkit both use FIREBASE_API_KEY. A different Vite key is not a substitute. */
export function firebaseWebKeyChoice(serverKey: string, viteKey: string) {
  const server = serverKey.trim();
  const vite = viteKey.trim();
  if (vite && server && vite !== server) {
    return { key: server, note: "VITE_FIREBASE_API_KEY and FIREBASE_API_KEY differ. Browser sign-in and Identity Toolkit both use FIREBASE_API_KEY. The Vite key was not applied." };
  }
  if (vite && !server) {
    return { key: "", note: "VITE_FIREBASE_API_KEY is set, but FIREBASE_API_KEY is empty. The Vite key was not used as a substitute." };
  }
  return { key: server, note: "" };
}

/** Saved form state is not the same thing as a verified provider connection. */
export function supabaseFormStatus(input: { configured: boolean; dirty: boolean; saving: boolean; projectState: string }) {
  if (input.saving) return { label: "Saving" as const };
  if (input.dirty) return { label: "Unsaved changes" as const };
  if (!input.configured) return { label: "Not configured" as const };
  if (input.projectState === "connected") return { label: "Connection verified" as const };
  if (input.projectState === "error") return { label: "Connection failed" as const };
  return { label: "Saved" as const };
}

export function interpretFirebaseStorage(status: number) {
  if (status === 200) {
    return { state: "connected" as const, detail: "The bucket allowed an anonymous listing. Review Firebase Security Rules before relying on it. This app did not upload or delete anything." };
  }
  if (status === 403) {
    return { state: "connected" as const, detail: "The bucket answered and blocked an anonymous listing. Rules appear to be in place. Uploads were not switched, and existing wedding files were not copied." };
  }
  if (status === 404) {
    return { state: "error" as const, detail: "That storage bucket was not found. Check storageBucket. Nothing was switched." };
  }
  return { state: "error" as const, detail: `Firebase Storage check failed (HTTP ${status}). Nothing was switched.` };
}

export function fcmReport(input: { sender: boolean; appId: boolean; vapid: boolean; worker?: boolean; serviceAccount?: boolean }) {
  const checks = [
    { id: "sender", label: "messagingSenderId is present", ok: input.sender },
    { id: "app", label: "Firebase web appId is present", ok: input.appId },
    { id: "vapid", label: "Server variable FIREBASE_VAPID_KEY is set (the value is not shown)", ok: input.vapid },
    { id: "worker", label: "A Firebase messaging service worker is part of this app", ok: input.worker === true },
    { id: "account", label: "Server variable FIREBASE_SERVICE_ACCOUNT_JSON is set (the private key is not shown)", ok: input.serviceAccount === true },
    { id: "device", label: "Each person must choose Enable notifications. Permission is never assumed.", ok: false },
  ];
  return {
    state: "needs_setup" as const,
    detail: "Cloud Messaging is not fully connected. Config values alone do not enable push, and browser permission is asked only after a person chooses it.",
    checks,
  };
}

export function analyticsReport(measurementId: string) {
  if (!measurementId) {
    return { state: "not_configured" as const, detail: "Analytics is off. Add a measurement id only if you intend to enable it later. No script was loaded." };
  }
  return { state: "needs_setup" as const, detail: "A measurement id is stored. Analytics is still off: no measurement script is loaded and no events are sent." };
}

export function rollupStatus(configured: boolean, project: CapabilityState | "") {
  if (!configured) return { status: "not_configured" as const, label: "Not configured" };
  if (project === "error") return { status: "error" as const, label: "Error" };
  if (project === "connected") return { status: "connected" as const, label: "Connected" };
  return { status: "needs_setup" as const, label: "Needs setup" };
}

export function decideServiceRequest(input: {
  service: string;
  choice: string;
  confirm: boolean;
  supabaseStorage: CapabilityState;
  firebaseStorage: CapabilityState;
  measurementConfigured: boolean;
  fcmReady: boolean;
}) {
  if (!input.confirm) return { ok: false as const, error: "Confirm before saving a service request. Nothing was switched." };
  if (input.service === "records") {
    return { ok: false as const, error: "Wedding records, memberships, chat and authentication stay on the current database. There is no switch." };
  }
  if (input.service === "media") {
    if (input.choice === "current") {
      return { ok: true as const, choice: "current", message: "Media stays on this app's library. No files were copied or deleted." };
    }
    if (input.choice === "supabase_storage") {
      if (input.supabaseStorage !== "connected") {
        return { ok: false as const, error: "Supabase Storage has not passed a connection test. Media stays on this app's library." };
      }
      return { ok: true as const, choice: "supabase_storage", message: "Request recorded only. Photos and videos still use this app's library. Existing files were not copied or deleted. A separate verified migration is required before uploads can move." };
    }
    if (input.choice === "firebase_storage") {
      if (input.firebaseStorage !== "connected") {
        return { ok: false as const, error: "Firebase Storage has not passed a connection test. Media stays on this app's library." };
      }
      return { ok: true as const, choice: "firebase_storage", message: "Request recorded only. Photos and videos still use this app's library. Existing files were not copied or deleted. A separate verified migration is required before uploads can move." };
    }
    return { ok: false as const, error: "That storage choice is not available." };
  }
  if (input.service === "push") {
    if (input.choice === "current") return { ok: true as const, choice: "current", message: "Push stays on in-app notifications. No device subscription was changed." };
    if (input.choice === "fcm" && !input.fcmReady) {
      return { ok: false as const, error: "Firebase Cloud Messaging is not connected. A sender id is not enough: this app has no messaging service worker, and browser permission cannot be assumed. Push was not switched." };
    }
    if (input.choice === "fcm") {
      return { ok: true as const, choice: "fcm", message: "Request recorded. Push messages are not sent by this phase." };
    }
    return { ok: false as const, error: "That push choice is not available." };
  }
  if (input.service === "analytics") {
    if (input.choice === "off") return { ok: true as const, choice: "off", message: "Analytics stays off. No script was loaded and no events were sent." };
    if (input.choice === "firebase_analytics") {
      if (!input.measurementConfigured) return { ok: false as const, error: "Add a Firebase measurement id first. Analytics stays off." };
      return { ok: true as const, choice: "firebase_analytics", message: "Request recorded. Analytics is still off in the app: no measurement script was loaded and no events were sent." };
    }
    return { ok: false as const, error: "That analytics choice is not available." };
  }
  return { ok: false as const, error: "That service cannot be changed here." };
}

export type FieldView = {
  id: string;
  label: string;
  env: string;
  secret: boolean;
  optional: boolean;
  present: boolean;
  hint: string;
  source: "environment" | "saved" | "none";
};

export type CapabilityView = {
  id: string;
  label: string;
  state: CapabilityState;
  detail: string;
  checkedAt: string;
  checks?: { id: string; label: string; ok: boolean }[];
};

function capability(list: CapabilityView[], id: string): CapabilityView {
  return list.find((item) => item.id === id) ?? { id, label: id, state: "not_configured", detail: "", checkedAt: "" };
}

export function buildCloudBoard(input: {
  databaseLabel: string;
  supabase: { fields: FieldView[]; capabilities: CapabilityView[]; savedAt?: string };
  firebase: { fields: FieldView[]; capabilities: CapabilityView[]; vapid: boolean; serviceAccount?: boolean };
  requests: { service: string; choice: string; note: string; updatedAt: string }[];
  actives?: { media?: string; push?: string; analytics?: string };
  worker?: boolean;
  fcmReady?: boolean;
}) {
  const supabaseProject = capability(input.supabase.capabilities, "project");
  const firebaseProject = capability(input.firebase.capabilities, "project");
  const supabaseConfigured = input.supabase.fields.every((field) => field.present);
  const firebaseRequired = input.firebase.fields.filter((field) => !field.optional);
  const firebaseConfigured = firebaseRequired.every((field) => field.present);
  const supabaseStatus = rollupStatus(supabaseConfigured, supabaseProject.state);
  const firebaseStatus = rollupStatus(firebaseConfigured, firebaseProject.state);
  const supabaseStorage = capability(input.supabase.capabilities, "storage").state;
  const firebaseStorage = capability(input.firebase.capabilities, "storage").state;
  const measurement = input.firebase.fields.find((field) => field.id === "measurementId");
  const requestFor = (service: string) => input.requests.find((item) => item.service === service) ?? null;
  const fcm = fcmReport({
    sender: Boolean(input.firebase.fields.find((field) => field.id === "messagingSenderId")?.present),
    appId: Boolean(input.firebase.fields.find((field) => field.id === "appId")?.present),
    vapid: input.firebase.vapid,
    worker: input.worker === true,
    serviceAccount: input.firebase.serviceAccount === true,
  });
  const mediaActive = input.actives?.media === "firebase_storage" ? "Firebase Storage for new uploads" : "This app's library";
  const pushActive = input.actives?.push === "fcm" ? "In-app notifications, with Firebase opt-in" : "In-app notifications";
  const analyticsActive = input.actives?.analytics === "firebase_analytics" ? "Firebase Analytics after a visitor agrees" : "Off";
  return {
    ok: true as const,
    databaseLabel: input.databaseLabel,
    note: "Wedding records, memberships, chat and sign-in stay on the current Postgres database. Supabase and Firebase are optional and are not used for those records. Saving public config does not switch a live service.",
    services: [
      {
        id: "records",
        label: "Wedding records, memberships, chat and authentication",
        active: input.databaseLabel,
        detail: "Source of truth. There is no one-click move to Supabase or Firebase. A core-data migration would be a separate, explicit project.",
        locked: true,
        requested: null,
        choices: [],
      },
      {
        id: "media",
        label: "Media storage",
        active: mediaActive,
        detail: "Device library plus published wedding media. Firebase Storage can take new uploads only after an authorised test file succeeds and you apply it. Existing files stay where they are.",
        locked: false,
        requested: requestFor("media"),
        choices: [
          { id: "current", label: "Keep the current library", allowed: true, reason: "" },
          { id: "supabase_storage", label: "Request Supabase Storage", allowed: supabaseStorage === "connected", reason: "Available only after Supabase Storage tests as Connected." },
          { id: "firebase_storage", label: "Request Firebase Storage", allowed: firebaseStorage === "connected", reason: "Available only after Firebase Storage tests as Connected." },
        ],
      },
      {
        id: "push",
        label: "Push notifications",
        active: pushActive,
        detail: "No push provider is active. Firebase Cloud Messaging cannot be marked connected from config values alone.",
        locked: false,
        requested: requestFor("push"),
        choices: [
          { id: "current", label: "Keep in-app notifications", allowed: true, reason: "" },
          { id: "fcm", label: "Firebase Cloud Messaging", allowed: input.fcmReady === true, reason: fcm.detail },
        ],
      },
      {
        id: "analytics",
        label: "Analytics",
        active: analyticsActive,
        detail: "Off until you apply it. Even then, no measurement script loads until a visitor agrees. No event is sent before that.",
        locked: false,
        requested: requestFor("analytics"),
        choices: [
          { id: "off", label: "Leave analytics off", allowed: true, reason: "" },
          { id: "firebase_analytics", label: "Record Firebase Analytics for later", allowed: Boolean(measurement?.present), reason: "Add measurementId and save it before this can be recorded." },
        ],
      },
    ],
    providers: [
      {
        id: "supabase" as const,
        title: "Supabase",
        ...supabaseStatus,
        configured: supabaseConfigured,
        tested: supabaseProject.state === "connected",
        lastTest: supabaseProject.state === "connected" ? supabaseProject.checkedAt : "",
        guidance: supabaseConfigured
          ? "Public project URL and publishable key only. Wedding data in this app is still on Postgres."
          : "Not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) in the server environment, or save the public values here. SUPABASE_SERVICE_ROLE_KEY must never be entered in this form.",
        secretNote: "The service-role key is server-only. Put it in SUPABASE_SERVICE_ROLE_KEY if a trusted server tool needs it. This page cannot store it, and it must not go in the browser, a client bundle, or a normal database row.",
        envLocked: input.supabase.fields.some((field) => field.source === "environment"),
        fields: input.supabase.fields,
        capabilities: input.supabase.capabilities,
      },
      {
        id: "firebase" as const,
        title: "Firebase",
        ...firebaseStatus,
        configured: firebaseConfigured,
        tested: firebaseProject.state === "connected",
        lastTest: firebaseProject.state === "connected" ? firebaseProject.checkedAt : "",
        guidance: "The web config is public project configuration, not an authorization system. Security Rules, App Check where appropriate, API restrictions and authorised domains still matter. A service-account private key is not accepted here.",
        secretNote: "FIREBASE_SERVICE_ACCOUNT_JSON and FIREBASE_VAPID_KEY stay in the server environment. Never paste a private key into this form.",
        envLocked: input.firebase.fields.some((field) => field.source === "environment"),
        fields: input.firebase.fields,
        capabilities: input.firebase.capabilities.map((item) => {
          if (item.id === "analytics") {
            const report = analyticsReport(measurement?.present ? measurement.hint || "set" : "");
            return { ...item, state: report.state, detail: report.detail };
          }
          if (item.id !== "messaging") return item;
          const configuredEnough = fcm.checks[0].ok && fcm.checks[1].ok;
          return {
            ...item,
            checks: fcm.checks,
            state: configuredEnough ? fcm.state : "not_configured" as const,
            detail: configuredEnough ? fcm.detail : "Cloud Messaging is not configured. A sender id alone would still not count as connected.",
          };
        }),
      },
    ],
  };
}

export function interpretSupabaseProbe(error: { message?: string; code?: string } | null, secrets: string[]) {
  if (!error) {
    return { state: "connected" as const, detail: "Supabase accepted the publishable key for a read-only request. Wedding records were not read or moved." };
  }
  const code = error.code || "";
  const message = error.message || "";
  if (code === "PGRST205" || code === "42P01" || /schema cache|could not find the table|does not exist/i.test(message)) {
    return { state: "connected" as const, detail: "The Supabase client reached PostgREST with the publishable key. No wedding table was queried. Records in this app stay on Postgres." };
  }
  if (code === "42501" || /permission denied|row-level security/i.test(message)) {
    return { state: "connected" as const, detail: "Supabase accepted the publishable key and Row Level Security blocked the probe. No rows were changed." };
  }
  if (/invalid api key|unauthorized|jwt/i.test(message) || code === "PGRST301") {
    return { state: "error" as const, detail: "The publishable key was refused. Use the anon or publishable key. Do not paste a service-role key." };
  }
  const extra = redactCloud(message, secrets);
  return { state: "error" as const, detail: extra ? `Supabase did not accept the read-only check. ${extra}` : "Supabase did not accept the read-only check." };
}

export function parseServiceAccount(raw: string) {
  const text = raw.trim();
  if (!text) return { ok: false as const, error: "FIREBASE_SERVICE_ACCOUNT_JSON is not set." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false as const, error: "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. The value was not shown." };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false as const, error: "FIREBASE_SERVICE_ACCOUNT_JSON could not be read. The value was not shown." };
  const row = parsed as Record<string, unknown>;
  const projectId = typeof row.project_id === "string" ? row.project_id : "";
  const clientEmail = typeof row.client_email === "string" ? row.client_email : "";
  const privateKey = typeof row.private_key === "string" ? row.private_key.replace(/\\n/g, "\n") : "";
  if (row.type !== "service_account" || !/^[a-z0-9-]{4,40}$/.test(projectId) || !clientEmail.includes("@") || !privateKey.includes("BEGIN PRIVATE KEY")) {
    return { ok: false as const, error: "FIREBASE_SERVICE_ACCOUNT_JSON must be a Firebase service account. The value was not shown." };
  }
  return { ok: true as const, projectId, clientEmail, privateKey };
}

export function decideCloudApply(input: {
  service: string;
  choice: string;
  confirm: boolean;
  serviceAccount: boolean;
  storageProbe: "passed" | "failed" | "skipped";
  fcmServerReady: boolean;
  measurementConfigured: boolean;
  consentAcknowledged: boolean;
}) {
  if (!input.confirm) return { ok: false as const, error: "Confirm before applying. The current provider stays active." };
  if (input.service === "records" || input.choice === "supabase_storage") {
    return { ok: false as const, error: "Wedding records, chat and sign-in stay where they are. Supabase Storage is not used for wedding files." };
  }
  if (input.service === "media") {
    if (input.choice === "current") {
      return { ok: true as const, active: "library", message: "New uploads stay on this app's library. Files already stored were not moved or deleted." };
    }
    if (input.choice === "firebase_storage") {
      if (!input.serviceAccount) {
        return { ok: false as const, error: "Firebase Storage was not activated. Set FIREBASE_SERVICE_ACCOUNT_JSON on the server so membership and size checks stay on the server. A browser API key cannot do that. The current library stays active." };
      }
      if (input.storageProbe !== "passed") {
        return { ok: false as const, error: "The disposable upload test did not succeed. New uploads stay on this app's library. No wedding file was moved." };
      }
      return { ok: true as const, active: "firebase_storage", message: "New shared uploads will use Firebase Storage. Files already in this app's library stay there and still open." };
    }
    return { ok: false as const, error: "That storage choice cannot be applied." };
  }
  if (input.service === "push") {
    if (input.choice === "current") return { ok: true as const, active: "inbox", message: "Notifications stay in the app. No device token was changed." };
    if (input.choice === "fcm") {
      if (!input.fcmServerReady) {
        return { ok: false as const, error: "Push stays in the app. Still needed: FIREBASE_VAPID_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, the messaging sender id, the app id, and a successful sender check. People are asked for permission only if they choose Enable notifications." };
      }
      return { ok: true as const, active: "fcm", message: "Push can be offered. Nobody is subscribed until they choose Enable notifications. In-app notices still work." };
    }
    return { ok: false as const, error: "That push choice cannot be applied." };
  }
  if (input.service === "analytics") {
    if (input.choice === "off") return { ok: true as const, active: "off", message: "Analytics stays off. No script was loaded and no events were sent." };
    if (input.choice === "firebase_analytics") {
      if (!input.measurementConfigured) return { ok: false as const, error: "Add a measurement id first. Analytics stays off." };
      if (!input.consentAcknowledged) return { ok: false as const, error: "Confirm that visitors must agree before any analytics event is sent. Analytics stays off." };
      return { ok: true as const, active: "firebase_analytics", message: "Analytics stays quiet until a visitor agrees. No event was sent." };
    }
    return { ok: false as const, error: "That analytics choice cannot be applied." };
  }
  return { ok: false as const, error: "That change cannot be applied." };
}

export function publicRuntimeView(input: {
  analytics: boolean;
  push: "inbox" | "fcm";
  web: { apiKey: string; authDomain: string; projectId: string; messagingSenderId: string; appId: string; measurementId: string } | null;
  vapid: string;
}) {
  const quiet = { analytics: false as const, push: "inbox" as const };
  if (!input.analytics && input.push !== "fcm") return quiet;
  const web = input.web;
  if (!web?.apiKey || !web.appId || !web.projectId || looksPrivileged(web.apiKey)) return quiet;
  const vapid = input.push === "fcm" && input.vapid && !looksPrivileged(input.vapid) ? input.vapid : "";
  if (input.push === "fcm" && !vapid) {
    return input.analytics && web.measurementId
      ? { analytics: true as const, push: "inbox" as const, firebase: webConfig(web, web.measurementId), vapid: "" }
      : quiet;
  }
  return {
    analytics: input.analytics && Boolean(web.measurementId),
    push: input.push === "fcm" && vapid ? "fcm" as const : "inbox" as const,
    firebase: webConfig(web, input.analytics ? web.measurementId : ""),
    vapid,
  };
}

function webConfig(
  web: { apiKey: string; authDomain: string; projectId: string; messagingSenderId: string; appId: string },
  measurementId: string,
) {
  return {
    apiKey: web.apiKey,
    authDomain: web.authDomain,
    projectId: web.projectId,
    messagingSenderId: web.messagingSenderId,
    appId: web.appId,
    measurementId,
  };
}
