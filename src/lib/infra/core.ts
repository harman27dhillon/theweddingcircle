import { createHash } from "node:crypto";
import { firebaseWebAlignment, normalizeProjectId, parseServiceAccount } from "../developer/cloud.ts";
import { securityTag } from "./security.ts";
import { FLAG_IDS, FLAG_LABEL, MIGRATION_PHRASE, PACKAGING_NOTE, PRODUCTION_PHRASE, STATE_LABEL, type FlagId, type InfraState } from "./labels.ts";

export { FLAG_IDS, FLAG_LABEL, MIGRATION_PHRASE, PACKAGING_NOTE, PRODUCTION_PHRASE, STATE_LABEL };
export type { FlagId, InfraState };

export type EnvMap = Record<string, string | undefined>;
export type DbSourceName = "supabase" | "neon" | "pglite";

export type ProviderId = "database" | "firebase" | "r2" | "livestream" | "play" | "push";

export type CheckRow = { state: string; detail: string; fingerprint: string; checkedAt: string };

export type SecurityPosture = "operational" | "audit" | "na";

export type ProviderReport = {
  id: ProviderId;
  label: string;
  state: InfraState;
  missing: string[];
  detail: string;
  checklist: { label: string; done: boolean; tone?: SecurityPosture }[];
  external?: boolean;
  security: SecurityPosture;
};

const FIREBASE_WEB = ["FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID"] as const;
const R2_REQUIRED = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
const PLAY_PRODUCTS = ["PLAY_PRODUCT_PREMIUM_THEMES", "PLAY_PRODUCT_EXTRA_STORAGE", "PLAY_PRODUCT_PREMIUM_MEMBERSHIP"] as const;

export function appEnvironment(env: EnvMap): "development" | "test" | "production" {
  const raw = (env.APP_ENV || env.NODE_ENV || "development").trim().toLowerCase();
  if (raw === "production") return "production";
  if (raw === "test") return "test";
  return "development";
}

export function dbSourceFromEnv(env: EnvMap): DbSourceName {
  const supabase = env.SUPABASE_DB_URL?.trim() || "";
  if (supabase.startsWith("postgres")) return "supabase";
  if (env.DATABASE_URL?.trim()) return "neon";
  return "pglite";
}

function marker(env: EnvMap, key: string) {
  const value = env[key]?.trim() || "";
  if (!value) return "";
  return `${key}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function markers(env: EnvMap, keys: readonly string[]) {
  return keys.map((key) => marker(env, key)).filter(Boolean);
}

function present(env: EnvMap, key: string) {
  return Boolean(env[key]?.trim());
}

function missing(env: EnvMap, keys: readonly string[]) {
  return keys.filter((key) => !present(env, key));
}

function disabled(env: EnvMap, id: string) {
  return env[`INFRA_DISABLE_${id.toUpperCase()}`]?.trim() === "1";
}

function serviceAccountState(env: EnvMap, key: string) {
  const raw = env[key]?.trim() || "";
  if (!raw) return { state: "missing" as const };
  const parsed = parseServiceAccount(raw);
  if (!parsed.ok) return { state: "invalid" as const };
  return { state: "ok" as const, projectId: parsed.projectId };
}

export function fingerprint(keys: string[]) {
  return createHash("sha256").update([...keys].sort().join("|")).digest("hex").slice(0, 16);
}

export function displayState(assessed: InfraState, check: CheckRow | null, currentFingerprint: string): InfraState {
  if (assessed === "disabled" || assessed === "error" || assessed === "not_configured" || assessed === "incomplete") return assessed;
  if (!check || check.fingerprint !== currentFingerprint) return assessed;
  if (check.state === "verified") return "verified";
  if (check.state === "error") return "error";
  return assessed;
}

export function redactDetail(message: string, limit = 280) {
  const tags = [...new Set(message.match(/\[wc-(?:email|rls):[a-z0-9-]+\]/g) || [])];
  const cleaned = message
    .replace(/\[wc-(?:email|rls):[a-z0-9-]+\]/g, " ")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[private key removed]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database url removed]")
    .replace(/https?:\/\/\S*r2\.cloudflarestorage\.com\S*/gi, "[storage endpoint removed]")
    .replace(/\b(?:sk|rk|ya29|AKIA)[A-Za-z0-9_\-./+]{8,}\b/g, "[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{48,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = tags.length ? ` ${tags.join(" ")}` : "";
  const room = Math.max(0, limit - suffix.length);
  return `${cleaned.slice(0, room).trimEnd()}${suffix}`.slice(0, limit);
}

type Draft = {
  id: ProviderId;
  label: string;
  state: InfraState;
  missing: string[];
  detail: string;
  checklist: { label: string; done: boolean; tone?: SecurityPosture }[];
  external?: boolean;
  presentKeys: string[];
  security: SecurityPosture;
};

function finish(env: EnvMap, draft: Draft, checks: Partial<Record<ProviderId, CheckRow>>): ProviderReport {
  const id = draft.id;
  if (disabled(env, id)) {
    return {
      id,
      label: draft.label,
      state: "disabled",
      missing: draft.missing,
      detail: "Disabled by the server environment. No connection was attempted.",
      checklist: draft.checklist,
      external: draft.external,
      security: draft.security,
    };
  }
  const mark = fingerprint(draft.presentKeys);
  const state = displayState(draft.state, checks[id] || null, mark);
  const check = checks[id];
  const detail = state === "error" && check?.fingerprint === mark && check.detail
    ? check.detail
    : state === "verified" && check?.fingerprint === mark && check.detail
      ? check.detail
      : draft.detail;
  const checklist = draft.checklist.map((step) => step.label.toLowerCase().includes("test") ? { ...step, done: state === "verified" } : step);
  return { id, label: draft.label, state, missing: draft.missing, detail, checklist, external: draft.external, security: draft.security };
}

export function assessInfrastructure(env: EnvMap, checks: Partial<Record<ProviderId, CheckRow>> = {}) {
  const database = dbSourceFromEnv(env);
  const firebaseAccount = serviceAccountState(env, "FIREBASE_SERVICE_ACCOUNT_JSON");
  const playAccount = serviceAccountState(env, "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  const webMissing = missing(env, FIREBASE_WEB);
  const r2Missing = missing(env, R2_REQUIRED);
  const productIds = PLAY_PRODUCTS.filter((key) => present(env, key));
  const liveProvider = (env.LIVESTREAM_PROVIDER || "").trim().toLowerCase();
  const cloudflareReady = present(env, "CLOUDFLARE_ACCOUNT_ID") && present(env, "CLOUDFLARE_REALTIME_APP_ID") && present(env, "CLOUDFLARE_REALTIME_API_TOKEN");

  const firebaseMark = fingerprint(markers(env, [...FIREBASE_WEB, "FIREBASE_SERVICE_ACCOUNT_JSON"]));
  const databaseMark = fingerprint([database]);
  const r2Mark = fingerprint(markers(env, [...R2_REQUIRED, "R2_PUBLIC_DOMAIN", "R2_JURISDICTION"]));
  const firebaseSaved = checks.firebase?.fingerprint === firebaseMark ? checks.firebase.detail || "" : "";
  const databaseSaved = checks.database?.fingerprint === databaseMark ? checks.database.detail || "" : "";
  const r2Saved = checks.r2?.fingerprint === r2Mark ? checks.r2.detail || "" : "";
  const email = securityTag(firebaseSaved, "email");
  const rls = securityTag(databaseSaved, "rls");
  const r2Private = checks.r2?.state === "verified" && checks.r2.fingerprint === r2Mark && /private bucket/i.test(r2Saved);
  const emailCheckedAt = checks.firebase?.fingerprint === firebaseMark ? checks.firebase.checkedAt || "" : "";
  const emailStamp = emailCheckedAt ? ` Last read ${emailCheckedAt}.` : "";
  const emailStep = email === "enabled"
    ? { label: `Email/Password provider is enabled. Email link was not counted.${emailStamp}`, done: true }
    : email === "disabled"
      ? { label: `Email/Password provider is not enabled on this Firebase project.${emailStamp}`, done: false }
      : email === "link"
        ? { label: `Email link is on. Email/Password is not enabled.${emailStamp}`, done: false }
        : email === "permission"
          ? { label: `Email/Password provider status is unavailable because of permissions. This is not treated as disabled.${emailStamp}`, done: false }
          : email === "invalid"
            ? { label: `Email/Password provider could not be read because the credentials were refused. This is not treated as disabled.${emailStamp}`, done: false }
            : email === "network"
              ? { label: `Email/Password provider could not be read because of an API or network failure. This is not treated as disabled.${emailStamp}`, done: false }
              : email === "unread"
                ? { label: `Email/Password provider could not be read. This is not treated as disabled.${emailStamp}`, done: false }
                : firebaseSaved
                  ? { label: `Email/Password provider was not stored from the last connection test. Run the test again. This is not treated as disabled.${emailStamp}`, done: false }
                  : { label: "Email/Password provider has not been read yet", done: false };
  const rlsStep = rls === "on"
    ? { label: "Supabase row level security is on and the publishable key has no wedding grants", done: true, tone: "operational" as const }
    : rls === "na"
      ? { label: "Supabase row level security applies only when a Supabase database URL is set", done: true, tone: "na" as const }
      : rls === "off"
        ? { label: "Supabase row level security is not in place", done: false, tone: "audit" as const }
        : rls === "unread"
          ? { label: "Supabase row level security could not be read", done: false, tone: "audit" as const }
          : { label: "Supabase row level security has not been read yet", done: false, tone: "audit" as const };

  let firebaseState: InfraState = "not_configured";
  let firebaseDetail = "Firebase is not configured. The current sign-in is unchanged.";
  const webAligned = webMissing.length === 0
    ? firebaseWebAlignment({
      projectId: env.FIREBASE_PROJECT_ID || "",
      authDomain: env.FIREBASE_AUTH_DOMAIN || "",
      appId: env.FIREBASE_APP_ID || "",
      senderId: env.FIREBASE_MESSAGING_SENDER_ID || "",
    })
    : { ok: true as const };
  if (firebaseAccount.state === "invalid") {
    firebaseState = "error";
    firebaseDetail = "FIREBASE_SERVICE_ACCOUNT_JSON could not be read. The value was not shown. The current sign-in is unchanged.";
  } else if (firebaseAccount.state === "ok" && present(env, "FIREBASE_PROJECT_ID") && normalizeProjectId(firebaseAccount.projectId) !== normalizeProjectId(env.FIREBASE_PROJECT_ID || "")) {
    firebaseState = "error";
    firebaseDetail = `Saved project id is ${normalizeProjectId(env.FIREBASE_PROJECT_ID || "")}. The service account project id is ${normalizeProjectId(firebaseAccount.projectId)}. Nothing was switched.`;
  } else if (webMissing.length === 0 && !webAligned.ok) {
    firebaseState = "error";
    firebaseDetail = webAligned.detail;
  } else if (webMissing.length === 0) {
    firebaseState = "ready";
    firebaseDetail = firebaseAccount.state === "ok"
      ? "Web config and a service account are present. Run the server test before activation. The current sign-in is unchanged."
      : "Public web fields are present. A service account is still required before server-side checks. The current sign-in is unchanged.";
  } else if (webMissing.length < FIREBASE_WEB.length || firebaseAccount.state === "ok") {
    firebaseState = "incomplete";
    firebaseDetail = "Some Firebase fields are set and some are missing. Nothing was switched.";
  }

  let r2State: InfraState = "not_configured";
  let r2Detail = "R2 is not configured. New photos and videos cannot be stored.";
  if (r2Missing.length === 0) {
    r2State = "ready";
    r2Detail = "R2 credentials are present. New wedding media uses this private bucket. Older files are not moved.";
  } else if (r2Missing.length < R2_REQUIRED.length) {
    r2State = "incomplete";
    r2Detail = "R2 is only partly configured. No file has been moved.";
  }

  let liveState: InfraState = "not_configured";
  let liveDetail = "No external livestream provider is configured. The in-app camera on Live is unchanged.";
  if (liveProvider && liveProvider !== "none" && liveProvider !== "in-app" && liveProvider !== "webrtc") {
    if (liveProvider !== "cloudflare-realtimekit") {
      liveState = "error";
      liveDetail = "That livestream provider is not supported. No meeting was created. The in-app camera is unchanged.";
    } else if (!cloudflareReady) {
      liveState = "incomplete";
      liveDetail = "Cloudflare RealtimeKit is selected, but the account id, app id, or API token is missing. No meeting was created.";
    } else {
      liveState = "ready";
      liveDetail = "Cloudflare RealtimeKit credentials are present. The test reads presets only. It does not create a meeting.";
    }
  }

  let playState: InfraState = "not_configured";
  let playDetail = "Google Play Billing is not configured. No product was created and no purchase was recorded.";
  if (playAccount.state === "invalid") {
    playState = "error";
    playDetail = "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON could not be read. The value was not shown.";
  } else if (!present(env, "GOOGLE_PLAY_PACKAGE_NAME") && playAccount.state === "missing" && productIds.length === 0) {
    playState = "not_configured";
  } else if (!present(env, "GOOGLE_PLAY_PACKAGE_NAME") || playAccount.state !== "ok" || productIds.length === 0) {
    playState = "incomplete";
    playDetail = productIds.length === 0
      ? "Play credentials are incomplete. Product ids are not set, and no price was invented."
      : "Play credentials are incomplete. No purchase was recorded.";
  } else {
    playState = "ready";
    playDetail = "Play package, service account, and at least one product id are present. Purchases still have to be verified with Google. This web app cannot unlock a feature from the browser alone.";
  }

  const pushMissing = [
    ...missing(env, ["FIREBASE_VAPID_KEY", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID"]),
    ...(firebaseAccount.state === "ok" ? [] : ["FIREBASE_SERVICE_ACCOUNT_JSON"]),
  ];
  let pushState: InfraState = "not_configured";
  let pushDetail = "Push notifications are not configured. People are not asked for permission.";
  if (firebaseAccount.state === "invalid" && present(env, "FIREBASE_VAPID_KEY")) {
    pushState = "error";
    pushDetail = "Push cannot be checked because the Firebase service account could not be read.";
  } else if (pushMissing.length === 0) {
    pushState = "ready";
    pushDetail = "Push credentials are present. Permission is not requested until a later, separate activation.";
  } else if (pushMissing.length < 4) {
    pushState = "incomplete";
    pushDetail = "Push is only partly configured. Permission is not requested.";
  }

  const databaseState: InfraState = "ready";
  const databaseDetail = database === "pglite"
    ? "The app is using its embedded database. A cloud database URL is not set. Wedding data was not moved."
    : database === "supabase"
      ? "A Supabase database URL is set. Run the test before treating it as verified. The URL is not shown."
      : "A cloud database URL is set. Run the test before treating it as verified. The URL is not shown.";

  const drafts: Draft[] = [
    {
      id: "database",
      label: "App database",
      state: databaseState,
      missing: database === "pglite" ? ["SUPABASE_DB_URL or DATABASE_URL"] : [],
      detail: databaseDetail,
      external: database !== "pglite",
      presentKeys: [database],
      security: database === "supabase" ? (rls === "on" ? "operational" : "audit") : "na",
      checklist: [
        { label: "Embedded preview database is available when no cloud URL is set", done: true },
        { label: "Cloud database URL (Supabase or the existing database URL)", done: database !== "pglite" },
        { label: "Server test (select 1) without printing the URL", done: false },
        rlsStep,
      ],
    },
    {
      id: "firebase",
      label: "Firebase / Google Cloud",
      state: firebaseState,
      missing: [...webMissing, ...(firebaseAccount.state === "ok" ? [] : ["FIREBASE_SERVICE_ACCOUNT_JSON"])],
      detail: firebaseDetail,
      presentKeys: markers(env, [...FIREBASE_WEB, "FIREBASE_SERVICE_ACCOUNT_JSON"]),
      security: "audit",
      checklist: [
        { label: "Firebase project id", done: present(env, "FIREBASE_PROJECT_ID") },
        { label: "Web app config (api key, auth domain, app id)", done: webMissing.length === 0 && webAligned.ok },
        emailStep,
        { label: "Server service account for privileged checks", done: firebaseAccount.state === "ok" },
        { label: "Firestore, Realtime Database and Firebase Storage rules", done: true, tone: "na" },
        { label: "Wedding membership stays in Supabase. A Firebase account is not a wedding member by itself", done: true },
      ],
    },
    {
      id: "r2",
      label: "Cloudflare R2",
      state: r2State,
      missing: r2Missing,
      detail: r2Detail,
      presentKeys: markers(env, [...R2_REQUIRED, "R2_PUBLIC_DOMAIN", "R2_JURISDICTION"]),
      security: r2State === "not_configured" ? "na" : r2Private ? "operational" : "audit",
      checklist: [
        { label: "Account id, bucket, access key, and secret on the server", done: r2Missing.length === 0 },
        { label: "Bucket remains private", done: r2Private, tone: r2Private ? "operational" : r2State === "not_configured" ? "na" : "audit" },
        { label: "Optional custom media domain", done: present(env, "R2_PUBLIC_DOMAIN") },
        { label: "Safe bucket test before any wedding file is moved", done: false },
      ],
    },
    {
      id: "livestream",
      label: "Livestream provider",
      state: liveState,
      missing: liveProvider === "cloudflare-realtimekit"
        ? ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_REALTIME_APP_ID", "CLOUDFLARE_REALTIME_API_TOKEN"].filter((key) => !present(env, key))
        : ["LIVESTREAM_PROVIDER=cloudflare-realtimekit"],
      detail: liveDetail,
      presentKeys: markers(env, ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_REALTIME_APP_ID", "CLOUDFLARE_REALTIME_API_TOKEN", "LIVESTREAM_PROVIDER"]),
      security: "na",
      checklist: [
        { label: "Keep the existing in-app camera separate from storage", done: true },
        { label: "Choose Cloudflare RealtimeKit only when an account is ready", done: liveProvider === "cloudflare-realtimekit" && cloudflareReady },
        { label: "Token test reads presets and does not create a meeting", done: false },
        { label: "Private playback for wedding members only", done: false },
      ],
    },
    {
      id: "play",
      label: "Google Play Billing",
      state: playState,
      missing: [
        ...(!present(env, "GOOGLE_PLAY_PACKAGE_NAME") ? ["GOOGLE_PLAY_PACKAGE_NAME"] : []),
        ...(playAccount.state === "ok" ? [] : ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"]),
        ...(productIds.length ? [] : ["At least one PLAY_PRODUCT_* id from Play Console"]),
      ],
      detail: playDetail,
      presentKeys: markers(env, ["GOOGLE_PLAY_PACKAGE_NAME", "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", ...PLAY_PRODUCTS]),
      security: "na",
      checklist: [
        { label: "This app is a web app, not a native Android billing screen", done: true },
        { label: "Play Console app and Android package name", done: present(env, "GOOGLE_PLAY_PACKAGE_NAME") },
        { label: "Real product ids created in Play Console (none are invented here)", done: productIds.length > 0 },
        { label: "Server service account with Android Publisher access", done: playAccount.state === "ok" },
        { label: "Trusted Web Activity or other wrapper before a phone can start a purchase", done: false },
      ],
    },
    {
      id: "push",
      label: "Push notifications",
      state: pushState,
      missing: pushMissing,
      detail: pushDetail,
      presentKeys: markers(env, ["FIREBASE_VAPID_KEY", "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_APP_ID", "FIREBASE_SERVICE_ACCOUNT_JSON"]),
      security: "na",
      checklist: [
        { label: "VAPID key on the server", done: present(env, "FIREBASE_VAPID_KEY") },
        { label: "Messaging sender id and app id", done: present(env, "FIREBASE_MESSAGING_SENDER_ID") && present(env, "FIREBASE_APP_ID") },
        { label: "Service account", done: firebaseAccount.state === "ok" },
        { label: "People are asked only after a later opt-in", done: false },
      ],
    },
  ];

  const providers = drafts.map((draft) => finish(env, draft, checks));
  return {
    environment: appEnvironment(env),
    database,
    providers,
    fingerprint: Object.fromEntries(drafts.map((draft) => [draft.id, fingerprint(draft.presentKeys)])) as Record<ProviderId, string>,
  };
}

export function publicInfraHealth(env: EnvMap) {
  const report = assessInfrastructure(env);
  const optional: Record<string, InfraState> = {};
  for (const provider of report.providers) {
    if (provider.id === "database") continue;
    optional[provider.id] = provider.state === "verified" ? "ready" : provider.state;
  }
  return {
    ok: true,
    environment: report.environment,
    database: report.database === "pglite" ? "embedded" : "configured",
    optional,
  };
}

export type FlagDecisionInput = {
  id: FlagId;
  enable: boolean;
  confirm: boolean;
  phrase: string;
  providers: Partial<Record<ProviderId, InfraState>>;
  databaseExternal: boolean;
  appEnv: "development" | "test" | "production";
};

export function decideFlag(input: FlagDecisionInput): { ok: true } | { ok: false; error: string } {
  if (!FLAG_IDS.includes(input.id)) return { ok: false, error: "That setting is not available." };
  if (!input.confirm) return { ok: false, error: "Confirm the change before it is saved." };
  if (!input.enable) return { ok: true };
  const stateOf = (id: ProviderId) => input.providers[id] || "not_configured";
  const needVerified = (id: ProviderId, label: string) => {
    const state = stateOf(id);
    if (state === "disabled") return `${label} is disabled on the server.`;
    if (state !== "verified") return `${label} has not passed a server test. Turning the switch on was refused.`;
    return "";
  };
  if (input.id === "firebaseAuth") {
    const error = needVerified("firebase", "Firebase");
    if (error) return { ok: false, error };
  }
  if (input.id === "cloudDatabase") {
    if (!input.databaseExternal) return { ok: false, error: "No cloud database URL is set. The current database stays in use." };
    const error = needVerified("database", "The database");
    if (error) return { ok: false, error };
  }
  if (input.id === "r2Media" || input.id === "mediaMigration") {
    const error = needVerified("r2", "R2");
    if (error) return { ok: false, error };
  }
  if (input.id === "livestream") {
    const error = needVerified("livestream", "The livestream provider");
    if (error) return { ok: false, error };
  }
  if (input.id === "playBilling") {
    const error = needVerified("play", "Google Play Billing");
    if (error) return { ok: false, error };
  }
  if (input.id === "pushNotifications") {
    const error = needVerified("push", "Push notifications");
    if (error) return { ok: false, error };
  }
  if (input.id === "mediaMigration" && input.phrase.trim() !== MIGRATION_PHRASE) {
    return { ok: false, error: `Type ${MIGRATION_PHRASE} to arm migration. No files are copied by this switch.` };
  }
  if (input.id === "productionMode") {
    if (input.appEnv !== "production") return { ok: false, error: "Production mode stays off unless APP_ENV is production." };
    if (input.phrase.trim() !== PRODUCTION_PHRASE) return { ok: false, error: `Type ${PRODUCTION_PHRASE} to confirm. Nothing was published.` };
  }
  return { ok: true };
}

export function effectiveFlag(enabled: boolean, state: InfraState) {
  return Boolean(enabled) && state === "verified";
}

/** A missing developer session must not receive the status board. */
export function sealedBoard<T extends { ok: true }>(session: { ok: true; email: string } | { ok: false; error: string }, board: T) {
  if (!session.ok) return { ok: false as const, error: "Developer session required." };
  return board;
}
