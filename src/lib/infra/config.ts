import { looksPrivileged, maskTail, normalizeProjectId, parseServiceAccount } from "../developer/cloud.ts";
import type { ProviderId } from "./core.ts";

export type ConfigInput = "text" | "password" | "json" | "select";

export type ConfigField = {
  key: string;
  label: string;
  input: ConfigInput;
  optional?: boolean;
  /** Public Firebase web config. Never a private key. */
  public?: boolean;
  hint?: string;
};

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const CONFIG_PROVIDERS = ["firebase", "r2", "livestream", "play", "push"] as const;
export type ConfigProviderId = (typeof CONFIG_PROVIDERS)[number];

export const CONFIG_FIELDS: Record<ConfigProviderId, ConfigField[]> = {
  firebase: [
    { key: "FIREBASE_API_KEY", label: "FIREBASE_API_KEY", input: "password", hint: "Firebase web apiKey. Saved on the server and not shown again. This is not a service-account private key." },
    { key: "FIREBASE_AUTH_DOMAIN", label: "FIREBASE_AUTH_DOMAIN", input: "text", public: true },
    { key: "FIREBASE_PROJECT_ID", label: "FIREBASE_PROJECT_ID", input: "text", public: true },
    { key: "FIREBASE_APP_ID", label: "FIREBASE_APP_ID", input: "text", public: true },
    { key: "FIREBASE_SERVICE_ACCOUNT_JSON", label: "Firebase service account JSON", input: "json", hint: "Used only on the server. Email/password and email verification stay settings in the Firebase Console. Saving this does not change how people sign in." },
  ],
  r2: [
    { key: "R2_ACCOUNT_ID", label: "R2_ACCOUNT_ID", input: "text", public: true },
    { key: "R2_BUCKET", label: "R2_BUCKET", input: "text", public: true },
    { key: "R2_ACCESS_KEY_ID", label: "R2_ACCESS_KEY_ID", input: "password" },
    { key: "R2_SECRET_ACCESS_KEY", label: "R2_SECRET_ACCESS_KEY", input: "password" },
    { key: "R2_PUBLIC_DOMAIN", label: "Custom media domain", input: "text", optional: true, public: true, hint: "Optional. Leave empty to keep the bucket private. No file is moved." },
  ],
  livestream: [
    { key: "LIVESTREAM_PROVIDER", label: "LIVESTREAM_PROVIDER", input: "select", optional: true, public: true, hint: "Cloudflare RealtimeKit only. Empty keeps the in-app camera. RealtimeKit needs its own API token with Realtime Admin permission. The old Stream token is not used." },
    { key: "CLOUDFLARE_ACCOUNT_ID", label: "CLOUDFLARE_ACCOUNT_ID", input: "text", public: true, hint: "The same 32-character Cloudflare account id. A second account id is not created." },
    { key: "CLOUDFLARE_REALTIME_APP_ID", label: "CLOUDFLARE_REALTIME_APP_ID", input: "text", public: true, hint: "RealtimeKit app id from the Cloudflare dashboard." },
    { key: "CLOUDFLARE_REALTIME_API_TOKEN", label: "CLOUDFLARE_REALTIME_API_TOKEN", input: "password", hint: "Server only. Create a token with Realtime Admin or Realtime permission. Do not paste the Stream token here." },
  ],
  play: [
    { key: "GOOGLE_PLAY_PACKAGE_NAME", label: "GOOGLE_PLAY_PACKAGE_NAME", input: "text", public: true },
    { key: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", label: "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", input: "json" },
    { key: "PLAY_PRODUCT_PREMIUM_THEMES", label: "PLAY_PRODUCT_PREMIUM_THEMES", input: "text", optional: true, public: true, hint: "Product id already created in Play Console." },
    { key: "PLAY_PRODUCT_EXTRA_STORAGE", label: "PLAY_PRODUCT_EXTRA_STORAGE", input: "text", optional: true, public: true, hint: "Product id already created in Play Console." },
    { key: "PLAY_PRODUCT_PREMIUM_MEMBERSHIP", label: "PLAY_PRODUCT_PREMIUM_MEMBERSHIP", input: "text", optional: true, public: true, hint: "Subscription id already created in Play Console." },
  ],
  push: [
    { key: "FIREBASE_VAPID_KEY", label: "FIREBASE_VAPID_KEY", input: "password" },
    { key: "FIREBASE_MESSAGING_SENDER_ID", label: "FIREBASE_MESSAGING_SENDER_ID", input: "text", public: true },
    { key: "FIREBASE_APP_ID", label: "FIREBASE_APP_ID", input: "text", public: true },
    { key: "FIREBASE_SERVICE_ACCOUNT_JSON", label: "FIREBASE_SERVICE_ACCOUNT_JSON", input: "json", hint: "Same server service account used for Firebase. The private key is not shown again." },
  ],
};

const NOTES: Record<ConfigProviderId, string> = {
  firebase: "Web config is stored for this server. The service-account private key stays on the server. Sign-in is not switched, and email verification is still enabled in the Firebase Console, not here.",
  r2: "New wedding photos and videos are stored in this private bucket. Leave the custom domain empty. The secret is not shown to guests. Older files are not moved or deleted.",
  livestream: "Choosing Cloudflare RealtimeKit does not create a meeting and does not replace the in-app camera until the connection test succeeds and the provider is armed.",
  play: "Product ids must already exist in Play Console. Nothing is purchased, and billing stays off until the server test succeeds and you arm it.",
  push: "People are not asked for notification permission by saving these fields.",
};

export function bareCloudflareToken(value: string) {
  let token = value.trim().replace(/^["']+|["']+$/g, "").trim();
  token = token.replace(/^Bearer\s+/i, "").replace(/^["']+|["']+$/g, "").trim();
  return token;
}

export function vapidShapeOk(value: string) {
  return /^[A-Za-z0-9_-]{20,200}$/.test(value) && !looksPrivileged(value);
}

/** Classifies a real Android Publisher in-app product list response. Does not create an edit. */
export function classifyPlayCatalog(status: number, body?: unknown) {
  if (status === 200) {
    let extra = "";
    if (body !== undefined) {
      if (!body || typeof body !== "object") extra = " The product list could not be read.";
      else {
        const list = (body as { inappproduct?: unknown }).inappproduct;
        if (!Array.isArray(list) || list.length === 0) extra = " The in-app product list was empty.";
        else {
          const more = (body as { tokenPagination?: { nextPageToken?: unknown } }).tokenPagination?.nextPageToken ? " More pages were not read." : "";
          extra = ` The in-app product list included ${list.length} product${list.length === 1 ? "" : "s"}.${more}`;
        }
      }
    }
    return { ok: true as const, detail: `Google Play accepted the service account for this package. No product was purchased and no entitlement was granted.${extra}` };
  }
  if (status === 401) return { ok: false as const, detail: "Google Play refused the service account. No purchase was granted." };
  if (status === 403) return { ok: false as const, detail: "The service account does not have permission for this Play app. No purchase was granted." };
  if (status === 404) return { ok: false as const, detail: "That package was not found in Play Console. No purchase was granted." };
  return { ok: false as const, detail: `Google Play did not confirm the package (HTTP ${status}). No purchase was granted.` };
}

/** One saved product or subscription. A 404 is a missing id, not a permission failure. */
export function classifyPlayProduct(status: number | null, kind: "one_time" | "subscription") {
  const label = kind === "subscription" ? "subscription" : "one-time product";
  if (status == null) return { ok: false as const, kind: "network" as const, detail: `Google Play did not answer the ${label} lookup. Nothing was purchased.` };
  if (status === 200) return { ok: true as const, kind: "found" as const, detail: `The ${label} exists in this Play app. Nothing was purchased.` };
  if (status === 404) return { ok: false as const, kind: "missing" as const, detail: `That ${label} was not found in this Play app. This is not an access-denied error. Nothing was purchased.` };
  if (status === 401) return { ok: false as const, kind: "invalid_credentials" as const, detail: "Google Play refused the service account. No purchase was granted." };
  if (status === 403) return { ok: false as const, kind: "permission" as const, detail: "The service account does not have permission for this Play app. No purchase was granted." };
  return { ok: false as const, kind: "api" as const, detail: `Google Play did not confirm the ${label} (HTTP ${status}). No purchase was granted.` };
}

export function configNote(provider: ConfigProviderId) {
  return NOTES[provider];
}

export function isConfigProvider(value: string): value is ConfigProviderId {
  return (CONFIG_PROVIDERS as readonly string[]).includes(value);
}

export function providerKeys(provider: ConfigProviderId) {
  return CONFIG_FIELDS[provider].map((field) => field.key);
}

export function affectedChecks(keys: string[]): ProviderId[] {
  const ids = new Set<ProviderId>();
  for (const key of keys) {
    if (key.startsWith("FIREBASE_") && key !== "FIREBASE_VAPID_KEY") ids.add("firebase");
    if (key === "FIREBASE_VAPID_KEY" || key === "FIREBASE_MESSAGING_SENDER_ID" || key === "FIREBASE_APP_ID" || key === "FIREBASE_SERVICE_ACCOUNT_JSON") ids.add("push");
    if (key.startsWith("R2_")) ids.add("r2");
    if (key.startsWith("CLOUDFLARE_") || key === "LIVESTREAM_PROVIDER") ids.add("livestream");
    if (key.startsWith("GOOGLE_PLAY_") || key.startsWith("PLAY_PRODUCT_")) ids.add("play");
  }
  return [...ids];
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fail(error: string) {
  return { ok: false as const, error };
}

function checkServiceAccount(raw: string, label: string) {
  const parsed = parseServiceAccount(raw);
  if (!parsed.ok) return fail(`${label} could not be read. The value was not saved and was not shown.`);
  return { ok: true as const, value: raw.trim() };
}

function checkPublic(key: string, value: string) {
  if (key === "FIREBASE_API_KEY") {
    if (!/^AIza[0-9A-Za-z_-]{20,180}$/.test(value) || looksPrivileged(value)) return fail("FIREBASE_API_KEY is not a Firebase web API key. A private key was not saved.");
  }
  if (key === "FIREBASE_AUTH_DOMAIN" && !HOST.test(value.toLowerCase())) return fail("FIREBASE_AUTH_DOMAIN is not a host name. Nothing was saved.");
  if (key === "FIREBASE_PROJECT_ID" && !/^[a-z0-9-]{4,40}$/.test(value.toLowerCase())) return fail("FIREBASE_PROJECT_ID is not in the expected shape. Nothing was saved.");
  if (key === "FIREBASE_APP_ID" && !/^1:\d+:web:[a-zA-Z0-9]{4,64}$/.test(value)) return fail("FIREBASE_APP_ID is not a Firebase web app id. Nothing was saved.");
  if (key === "FIREBASE_MESSAGING_SENDER_ID" && !/^\d{6,22}$/.test(value)) return fail("FIREBASE_MESSAGING_SENDER_ID must be the numeric sender id. Nothing was saved.");
  if (key === "R2_ACCOUNT_ID" && !/^[a-f0-9]{32}$/i.test(value)) return fail("R2_ACCOUNT_ID must be the 32-character Cloudflare account id. Nothing was saved.");
  if (key === "R2_BUCKET" && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) return fail("R2_BUCKET is not a bucket name. Nothing was saved.");
  if (key === "R2_ACCESS_KEY_ID" && !/^[A-Za-z0-9]{16,128}$/.test(value)) return fail("R2_ACCESS_KEY_ID was refused. Nothing was saved.");
  if (key === "R2_SECRET_ACCESS_KEY" && (value.length < 16 || value.length > 200 || /\s/.test(value))) return fail("R2_SECRET_ACCESS_KEY was refused. Nothing was saved.");
  if (key === "R2_PUBLIC_DOMAIN" && value && !HOST.test(value.toLowerCase())) return fail("The custom media domain must be a host name, without https://. Nothing was saved.");
  if (key === "CLOUDFLARE_ACCOUNT_ID" && !/^[a-f0-9]{32}$/i.test(value)) return fail("CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account id. Nothing was saved.");
  if (key === "CLOUDFLARE_REALTIME_APP_ID" && !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) return fail("CLOUDFLARE_REALTIME_APP_ID is not a RealtimeKit app id. Nothing was saved.");
  if (key === "CLOUDFLARE_REALTIME_API_TOKEN") {
    const token = bareCloudflareToken(value);
    if (token.length < 20 || token.length > 400 || looksPrivileged(token)) return fail("CLOUDFLARE_REALTIME_API_TOKEN was refused. Nothing was saved.");
    return { ok: true as const, value: token };
  }
  if (key === "GOOGLE_PLAY_PACKAGE_NAME" && !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)) return fail("GOOGLE_PLAY_PACKAGE_NAME is not an Android package name. Nothing was saved.");
  if (key.startsWith("PLAY_PRODUCT_") && !/^[a-zA-Z0-9._-]{3,80}$/.test(value)) return fail(`${key} is not a Play Console product id. No id was invented. Nothing was saved.`);
  if (key === "FIREBASE_VAPID_KEY" && (!/^[A-Za-z0-9_-]{20,200}$/.test(value) || looksPrivileged(value))) return fail("FIREBASE_VAPID_KEY was refused. Nothing was saved.");
  if (key === "LIVESTREAM_PROVIDER" && value !== "cloudflare-realtimekit") return fail("The only external livestream provider is cloudflare-realtimekit. Nothing was saved.");
  return { ok: true as const, value: key === "FIREBASE_PROJECT_ID" || key === "FIREBASE_AUTH_DOMAIN" || key === "R2_BUCKET" || key === "R2_PUBLIC_DOMAIN" ? value.toLowerCase() : value };
}

export const RETAINED_LIVESTREAM_KEYS = ["CLOUDFLARE_STREAM_API_TOKEN"] as const;

export function cleanProviderInput(
  provider: ConfigProviderId,
  incoming: Record<string, unknown>,
  previous: Record<string, string>,
) {
  const fields: Record<string, string> = {};
  for (const field of CONFIG_FIELDS[provider]) {
    const typed = cleanText(incoming[field.key]);
    const kept = previous[field.key]?.trim() || "";
    if (!typed) {
      if (kept && (field.input === "password" || field.input === "json" || !field.optional)) fields[field.key] = kept;
      continue;
    }
    if (field.input === "json") {
      const parsed = checkServiceAccount(typed, field.label);
      if (!parsed.ok) return parsed;
      fields[field.key] = parsed.value;
      continue;
    }
    const checked = checkPublic(field.key, field.key === "FIREBASE_API_KEY" ? normalizeWebApiKey(typed) : typed);
    if (!checked.ok) return checked;
    fields[field.key] = checked.value;
  }

  if (provider === "livestream") {
    const typedProvider = cleanText(incoming.LIVESTREAM_PROVIDER).toLowerCase();
    const typedAccount = cleanText(incoming.CLOUDFLARE_ACCOUNT_ID);
    const typedApp = cleanText(incoming.CLOUDFLARE_REALTIME_APP_ID);
    const typedToken = cleanText(incoming.CLOUDFLARE_REALTIME_API_TOKEN);
    const typedLegacy = cleanText(incoming.CLOUDFLARE_STREAM_API_TOKEN);
    if (typedProvider !== "cloudflare-realtimekit") {
      const unchanged = (typed: string, key: string, secret = false) => {
        if (!typed) return true;
        const next = secret ? bareCloudflareToken(typed) : typed;
        return next === (previous[key] || "");
      };
      if (
        !unchanged(typedAccount, "CLOUDFLARE_ACCOUNT_ID")
        || !unchanged(typedApp, "CLOUDFLARE_REALTIME_APP_ID")
        || !unchanged(typedToken, "CLOUDFLARE_REALTIME_API_TOKEN", true)
        || !unchanged(typedLegacy, "CLOUDFLARE_STREAM_API_TOKEN", true)
      ) {
        return fail("Select cloudflare-realtimekit before saving the account id, app id, or API token. Nothing was saved.");
      }
      const kept: Record<string, string> = {};
      for (const key of [...providerKeys("livestream"), ...RETAINED_LIVESTREAM_KEYS]) {
        if (previous[key]) kept[key] = previous[key];
      }
      return { ok: true as const, fields: kept };
    }
    if (!fields.CLOUDFLARE_ACCOUNT_ID || !fields.CLOUDFLARE_REALTIME_APP_ID || !fields.CLOUDFLARE_REALTIME_API_TOKEN) {
      return fail("Cloudflare RealtimeKit needs the account id, app id, and API token. Nothing was saved.");
    }
  }

  if (provider === "firebase") {
    for (const key of ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID", "FIREBASE_SERVICE_ACCOUNT_JSON"]) {
      if (!fields[key]) return fail(`${key} is required. Nothing was saved.`);
    }
    const account = parseServiceAccount(fields.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!account.ok || normalizeProjectId(account.projectId) !== normalizeProjectId(fields.FIREBASE_PROJECT_ID)) {
      return fail("The service account project does not match FIREBASE_PROJECT_ID. Nothing was saved.");
    }
  }

  if (provider === "r2") {
    for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      if (!fields[key]) return fail(`${key} is required. Nothing was saved.`);
    }
  }

  if (provider === "play") {
    if (!fields.GOOGLE_PLAY_PACKAGE_NAME || !fields.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
      return fail("The Play package name and service account are required. Nothing was saved.");
    }
    const products = ["PLAY_PRODUCT_PREMIUM_THEMES", "PLAY_PRODUCT_EXTRA_STORAGE", "PLAY_PRODUCT_PREMIUM_MEMBERSHIP"].filter((key) => fields[key]);
    if (!products.length) return fail("Enter at least one product id that already exists in Play Console. Nothing was saved.");
  }

  if (provider === "push") {
    for (const key of ["FIREBASE_VAPID_KEY", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_SERVICE_ACCOUNT_JSON"]) {
      if (!fields[key]) return fail(`${key} is required. Nothing was saved.`);
    }
  }

  return { ok: true as const, fields };
}

export type PublicField = {
  key: string;
  label: string;
  input: ConfigInput;
  optional: boolean;
  present: boolean;
  locked: boolean;
  source: "environment" | "saved" | "none";
  value: string;
  mask: string;
  hint: string;
};

export type PublicForm = {
  id: ConfigProviderId;
  note: string;
  fields: PublicField[];
};

function maskSecret(key: string, value: string) {
  if (!value) return "";
  if (key === "FIREBASE_API_KEY" || key.includes("JSON") || key.includes("PRIVATE") || key === "R2_ACCESS_KEY_ID" || key === "R2_SECRET_ACCESS_KEY") return "Saved on the server";
  return maskTail(value);
}

/** Quotes, a Bearer prefix, and whitespace are not part of a Firebase web API key. */
export function normalizeWebApiKey(value: string) {
  let key = value.trim().replace(/^\uFEFF/, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = key.replace(/^Bearer\s+/i, "").trim().replace(/^["']+|["']+$/g, "").trim();
    if (next === key) break;
    key = next;
  }
  const compact = key.replace(/\s+/g, "");
  if (/^AIza[0-9A-Za-z_-]{20,180}$/.test(compact)) return compact;
  const matches = compact.match(/AIza[0-9A-Za-z_-]{20,180}/g) || [];
  if (matches.length === 1 && compact.replace(matches[0], "") === "") return matches[0];
  return compact;
}

function webKeyOk(value: string) {
  return /^AIza[0-9A-Za-z_-]{20,180}$/.test(value);
}

function keyTail(value: string) {
  return value.length >= 12 ? value.slice(-4) : "";
}

/**
 * The key placed on the Identity Toolkit request.
 * A well-formed saved key overrides the server environment, matching the other typed settings.
 * A saved value that is not a web API key does not hide a well-formed server key, and it is not deleted.
 */
export function resolveFirebaseApiKey(environment: string | undefined, saved: string | undefined) {
  const envKey = normalizeWebApiKey(environment || "");
  const savedKey = normalizeWebApiKey(saved || "");
  const envOk = webKeyOk(envKey);
  const savedOk = webKeyOk(savedKey);
  let key = "";
  let source: "saved configuration" | "server environment" | "none" = "none";
  if (savedOk) {
    key = savedKey;
    source = "saved configuration";
  } else if (envOk) {
    key = envKey;
    source = "server environment";
  } else if (savedKey) {
    key = savedKey;
    source = "saved configuration";
  } else if (envKey) {
    key = envKey;
    source = "server environment";
  }
  return {
    key,
    source,
    length: key.length,
    last4: keyTail(key),
    envLast4: keyTail(envKey),
    savedLast4: keyTail(savedKey),
    savedOverridesEnvironment: Boolean(savedOk && envOk && savedKey !== envKey),
    malformedSavedIgnored: Boolean(savedKey && !savedOk && envOk),
  };
}

/** Last-four fingerprint only. The full key is never included. */
export function firebaseKeyDiagnostic(resolved: ReturnType<typeof resolveFirebaseApiKey>) {
  const parts = [
    `API key source: ${resolved.source}.`,
    `Length ${resolved.length}.`,
    resolved.last4 ? `Last four: ${resolved.last4}.` : "Last four: none.",
    `Saved last four: ${resolved.savedLast4 || "none"}. Server environment last four: ${resolved.envLast4 || "none"}.`,
  ];
  if (resolved.savedOverridesEnvironment) parts.push("A saved key overrides the server environment key. They differ. The saved value was not deleted.");
  if (resolved.malformedSavedIgnored) parts.push("A saved value was not a web API key, so the server environment key was used. The saved value was not deleted.");
  parts.push("The full key is not shown.");
  return parts.join(" ");
}

/** Fields safe to send to a signed-in developer. Secret values are never included. */
export function publicConfigForms(input: { environment: Record<string, string | undefined>; saved: Record<string, string> }): PublicForm[] {
  return CONFIG_PROVIDERS.map((id) => ({
    id,
    note: NOTES[id],
    fields: CONFIG_FIELDS[id].map((field) => {
      const fromEnv = input.environment[field.key]?.trim() || "";
      const fromSaved = input.saved[field.key]?.trim() || "";
      const effective = fromSaved || fromEnv;
      const locked = Boolean(fromEnv) && !fromSaved;
      const source = fromSaved ? "saved" as const : fromEnv ? "environment" as const : "none" as const;
      return {
        key: field.key,
        label: field.label,
        input: field.input,
        optional: Boolean(field.optional),
        present: Boolean(effective),
        locked,
        source,
        value: field.public ? effective : "",
        mask: field.public ? "" : maskSecret(field.key, effective),
        hint: field.hint || "",
      };
    }),
  }));
}

/**
 * Values saved from the developer form replace a server environment value.
 * A blank submission does not copy the environment into the vault.
 * Environment-only fields stay editable. Leaving one blank keeps the environment value.
 */
export function effectiveInfraEnv(environment: Record<string, string | undefined>, saved: Record<string, string>) {
  const base: Record<string, string | undefined> = { ...environment };
  for (const [key, value] of Object.entries(saved)) {
    if (key === "FIREBASE_API_KEY") continue;
    const next = value.trim();
    if (next) base[key] = next;
  }
  const apiKey = resolveFirebaseApiKey(environment.FIREBASE_API_KEY, saved.FIREBASE_API_KEY);
  if (apiKey.key) base.FIREBASE_API_KEY = apiKey.key;
  return base;
}

/**
 * Merge one provider's form into the vault.
 * A typed replacement is stored even when the server environment has an older value.
 * Leaving a secret blank keeps the previous secret. Environment values are not copied in.
 * `changed` is only keys whose effective value changed, so a verified check can expire.
 */
export function mergeSavedConfig(input: {
  provider: ConfigProviderId;
  incoming: Record<string, unknown>;
  saved: Record<string, string>;
  environment: Record<string, string | undefined>;
}) {
  const incoming: Record<string, unknown> = { ...input.incoming };
  const previous: Record<string, string> = {};
  for (const key of providerKeys(input.provider)) {
    const typed = cleanText(input.incoming[key]);
    const fromEnv = input.environment[key]?.trim() || "";
    const fromSaved = input.saved[key]?.trim() || "";
    if (fromSaved) previous[key] = fromSaved;
    else if (fromEnv) previous[key] = fromEnv;
    if (fromEnv && (!typed || typed === fromEnv)) incoming[key] = fromEnv;
  }
  const cleaned = cleanProviderInput(input.provider, incoming, previous);
  if (!cleaned.ok) return cleaned;
  const next: Record<string, string> = { ...input.saved };
  const changed: string[] = [];
  let write = false;
  const clearing = input.provider === "livestream" && Object.keys(cleaned.fields).length === 0;
  for (const key of providerKeys(input.provider)) {
    const typed = cleanText(input.incoming[key]);
    const fromEnv = input.environment[key]?.trim() || "";
    const fromSaved = input.saved[key]?.trim() || "";
    const secret = key.includes("SECRET") || key.includes("JSON") || key.includes("TOKEN") || key.includes("ACCESS_KEY") || key === "FIREBASE_VAPID_KEY" || key === "FIREBASE_API_KEY";
    if (fromEnv && (!typed || typed === fromEnv)) {
      if (!typed && secret && fromSaved) continue;
      if (next[key]) {
        delete next[key];
        write = true;
      }
      continue;
    }
    const value = clearing ? "" : cleaned.fields[key] || "";
    if (!value) {
      if (next[key]) {
        delete next[key];
        changed.push(key);
        write = true;
      }
      continue;
    }
    if (next[key] !== value) {
      next[key] = value;
      changed.push(key);
      write = true;
    }
  }
  if (input.provider === "livestream") {
    for (const key of RETAINED_LIVESTREAM_KEYS) {
      const kept = input.saved[key]?.trim() || "";
      if (kept && next[key] !== kept) {
        next[key] = kept;
        write = true;
      }
    }
  }
  return { ok: true as const, next, changed, write };
}

/** Firebase values after vault-over-environment resolution. Secrets stay on the server. */
export function firebaseRuntimeFromEnv(source: Record<string, string | undefined>) {
  return {
    apiKey: normalizeWebApiKey(source.FIREBASE_API_KEY || ""),
    authDomain: source.FIREBASE_AUTH_DOMAIN?.trim() || "",
    projectId: source.FIREBASE_PROJECT_ID?.trim() || "",
    storageBucket: source.FIREBASE_STORAGE_BUCKET?.trim() || "",
    messagingSenderId: source.FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
    appId: source.FIREBASE_APP_ID?.trim() || "",
    serviceAccountJson: source.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || "",
  };
}
