export type ManagerProvider = "neon" | "supabase" | "firebase";
export type LiveDatabase = "neon" | "supabase" | "preview" | "unknown";

export type RouteInput = {
  production: boolean;
  neonConfigured: boolean;
  neonVerified: boolean | null;
  supabaseConfigured: boolean;
  supabaseVerified: boolean | null;
  supabaseAuth: "missing" | "untested" | "ok" | "failed";
  cutover: "neon" | "supabase";
  phase: string;
  observedRoute: "neon" | "supabase" | null;
  mediaActive: "library" | "firebase";
  firebaseStorageVerified: boolean | null;
};

export type RouteRow = {
  id: string;
  label: string;
  configured: string;
  verified: string;
  serving: string;
  readWrite: string;
  state: string;
};

export type Diagnostic = {
  headline: string;
  failed: string;
  where: string;
  code: string;
  cause: string;
  changed: string;
  dataSafety: string;
  attempted: string;
  canFix: string;
  next: string;
  retrySafe: boolean;
};

const UNKNOWN = "Unknown — runtime verification required";

function verifiedLabel(value: boolean | null, ok: string, bad: string) {
  if (value === null) return "Configured, not tested";
  return value ? ok : bad;
}

function weddingLive(input: RouteInput): { live: LiveDatabase; serving: string; state: string } {
  if (!input.production) {
    return {
      live: "preview",
      serving: "This preview is not the published site. Published routing was not observed here.",
      state: "unknown",
    };
  }
  if (input.cutover === "supabase") {
    if (input.observedRoute === "supabase" && input.supabaseVerified !== false) {
      return { live: "supabase", serving: "Supabase Postgres", state: input.phase === "frozen" || input.phase === "reverse_verified" || input.phase === "syncing" ? "syncing" : "serving" };
    }
    return {
      live: "unknown",
      serving: input.supabaseVerified === false
        ? "The saved flag says Supabase, but Postgres was not verified. The previous database is not used in its place."
        : UNKNOWN,
      state: "blocked",
    };
  }
  if (input.observedRoute === "neon" && input.neonConfigured && input.neonVerified !== false) {
    return { live: "neon", serving: "Neon Postgres", state: "serving" };
  }
  if (!input.neonConfigured) {
    return { live: "unknown", serving: UNKNOWN, state: "not_configured" };
  }
  return { live: "unknown", serving: UNKNOWN, state: input.neonVerified === false ? "blocked" : "unknown" };
}

/** Actual serving provider per data category. A successful connection is not treated as production routing. */
export function productionRoutes(input: RouteInput): { live: LiveDatabase; rows: RouteRow[] } {
  const wedding = weddingLive(input);
  const writes = input.phase === "frozen" || input.phase === "reverse_verified" || input.phase === "syncing" ? "Writes paused" : "Reads and writes";
  const weddingRow = (id: string, label: string): RouteRow => ({
    id,
    label,
    configured: input.cutover === "supabase" ? "Saved flag: Supabase" : "Saved flag: current database (Neon when the server URL is set)",
    verified: verifiedLabel(input.supabaseVerified, "Supabase Postgres answered", "Supabase Postgres did not answer"),
    serving: wedding.serving,
    readWrite: wedding.live === "unknown" || wedding.live === "preview" ? "Not confirmed" : writes,
    state: wedding.state,
  });
  const neonAccounts = input.neonConfigured ? "Neon Postgres (Better Auth)" : "Not configured on this process";
  const mediaServing = input.mediaActive === "firebase"
    ? input.firebaseStorageVerified
      ? "Firebase Storage for new uploads. Existing library files stay put."
      : "Firebase Storage was requested, but it is not verified. Files still use this app's library."
    : "This app's library. Firebase is not serving wedding files.";
  return {
    live: wedding.live,
    rows: [
      {
        id: "accounts",
        label: "User accounts and authentication",
        configured: neonAccounts,
        verified: verifiedLabel(input.neonVerified, "Current database answered", "Current database did not answer"),
        serving: !input.production
          ? "Not observed on the published site"
          : input.neonConfigured
            ? "Configured on the current database. This request did not open an account session."
            : UNKNOWN,
        readWrite: input.neonVerified === false ? "Unavailable" : "Separate from wedding-data cutover",
        state: !input.neonConfigured ? "not_configured" : input.neonVerified === false ? "blocked" : input.neonVerified ? "connected" : "configured_untested",
      },
      weddingRow("wedding_core", "Wedding core records and settings"),
      weddingRow("memberships", "Memberships and access permissions"),
      weddingRow("activity", "Chat, posts, and wedding activity"),
      weddingRow("invitations", "Invitations and couple access"),
      {
        id: "media",
        label: "Media metadata and file storage",
        configured: input.mediaActive === "firebase" ? "Firebase Storage requested" : "App library on the current database",
        verified: verifiedLabel(input.firebaseStorageVerified, "Firebase Storage test file succeeded", "Firebase Storage was not verified"),
        serving: input.production ? mediaServing : "Not observed on the published site",
        readWrite: "Bytes are not part of the Postgres wedding copy",
        state: input.mediaActive === "firebase" && !input.firebaseStorageVerified ? "partial" : "healthy",
      },
      {
        id: "live",
        label: "Live-streaming and signaling",
        configured: "Current database. Not part of the Supabase wedding copy.",
        verified: verifiedLabel(input.neonVerified, "Current database answered", "Current database did not answer"),
        serving: input.production && input.observedRoute === "neon" ? "Current database" : UNKNOWN,
        readWrite: "Reads and writes on the current database",
        state: input.observedRoute === "neon" ? "serving" : "unknown",
      },
      {
        id: "offline",
        label: "Local offline cache and pending changes",
        configured: "This browser only",
        verified: "Not a server database",
        serving: "This device. A new device cannot see changes that were never uploaded.",
        readWrite: "Local queue",
        state: "healthy",
      },
    ],
  };
}

export function redactSecrets(text: string) {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://••••")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "••••")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g, "••••")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, "••••")
    .replace(/\bsb_(?:secret|publishable)_[0-9A-Za-z_-]+\b/g, "••••")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500);
}

export function looksLikeSecretPaste(value: string) {
  const raw = value.trim();
  if (!raw) return false;
  return /postgres(?:ql)?:\/\//i.test(raw)
    || /BEGIN [A-Z ]*PRIVATE KEY/.test(raw)
    || /service_role|private_key|service_account|sb_secret_/i.test(raw)
    || raw.startsWith("eyJ");
}

/** Saving never stores a privileged URL from the browser and never changes routing. */
export function saveConnectionDecision(input: { provider: ManagerProvider; pasted: string; confirm: boolean }) {
  if (looksLikeSecretPaste(input.pasted)) {
    const variable = input.provider === "neon" ? "DATABASE_URL" : input.provider === "supabase" ? "SUPABASE_DB_URL" : "FIREBASE_SERVICE_ACCOUNT_JSON";
    return {
      ok: false as const,
      error: `That value is a database URL or a private key. It was not saved and it was not written to browser storage. Set ${variable} in the server environment and publish. Routing was not changed.`,
    };
  }
  if (!input.confirm) {
    return { ok: false as const, error: "Save stays off until you confirm. Nothing was stored and routing was not changed." };
  }
  if (input.provider === "neon") {
    return {
      ok: true as const,
      persist: "none" as const,
      message: "Neon is read from DATABASE_URL. This form cannot store a database URL. The existing value was left untouched and traffic did not move.",
    };
  }
  return {
    ok: true as const,
    persist: "public" as const,
    message: "Only public client fields can be saved here. Privileged server credentials stay in the server environment. Routing was not changed.",
  };
}

export function transferDecision(input: {
  source: ManagerProvider;
  destination: ManagerProvider;
  execute: boolean;
  confirm: boolean;
  productionSource: boolean;
  extras: number;
  conflicts: number;
  missing: number;
}) {
  if (input.source === "firebase" || input.destination === "firebase") {
    return {
      ok: false as const,
      mode: "blocked" as const,
      error: "Firebase is not the wedding database. Wedding rows stay in Postgres. Firebase Storage, when verified, stores media bytes only. No wedding rows were copied.",
    };
  }
  if (input.source === input.destination) {
    return { ok: false as const, mode: "blocked" as const, error: "Choose two different databases. Nothing was copied." };
  }
  if (!input.productionSource) {
    return {
      ok: false as const,
      mode: "blocked" as const,
      error: "This process is not the published Neon database. Transfer stays off so a local database cannot overwrite Supabase. Nothing was copied.",
    };
  }
  if (!input.execute) {
    return {
      ok: true as const,
      mode: "preview" as const,
      error: "",
    };
  }
  if (!input.confirm) {
    return { ok: false as const, mode: "blocked" as const, error: "Transfer stays off until you confirm it. Nothing was copied and routing was not changed." };
  }
  const note = input.extras || input.conflicts
    ? ` Destination-only rows: ${input.extras}. Field conflicts: ${input.conflicts}. Missing on the destination: ${input.missing}. Extras are kept. Conflicts are snapshotted. Routing does not change.`
    : " Routing does not change.";
  return { ok: true as const, mode: "copy" as const, error: note };
}

export function activateDecision(input: {
  confirm: boolean;
  auditOk: boolean;
  extras: number;
  conflicts: number;
  missing: number;
  publicClosed: boolean;
  serverAccessOk: boolean;
  orphanInvites: number;
  duplicateIds: number;
}) {
  if (!input.confirm) return { ok: false as const, error: "Activation stays off until you confirm it. Routing was not changed." };
  if (!input.auditOk || input.extras > 0 || input.conflicts > 0 || input.missing > 0) {
    return { ok: false as const, error: "Activation is blocked. Counts, destination-only rows, or field conflicts are still open. Nothing was switched." };
  }
  if (!input.publicClosed || !input.serverAccessOk) {
    return { ok: false as const, error: "Activation is blocked until public access is closed and the server role can read and write the wedding tables. Nothing was switched." };
  }
  if (input.orphanInvites > 0 || input.duplicateIds > 0) {
    return { ok: false as const, error: "Activation is blocked by a broken invitation link or a duplicate chat id. Nothing was switched." };
  }
  return { ok: true as const, error: "" };
}

export function syncDecision(input: { confirm: boolean; live: LiveDatabase; phase: string; productionSource: boolean }) {
  if (!input.productionSource) {
    return { ok: false as const, error: "Sync stays off on this preview so a local database cannot overwrite the published one. Nothing was copied." };
  }
  if (!input.confirm) return { ok: false as const, error: "Sync stays off until you confirm it. Routing was not changed." };
  if (input.live === "supabase") {
    return { ok: false as const, error: "Supabase is serving wedding writes. Sync Now will not copy the previous database over those rows. Freeze writes and use reverse sync if you mean to roll back." };
  }
  if (input.live === "unknown") {
    return { ok: false as const, error: "Sync stays off until this process can see which database is serving writes. Nothing was copied." };
  }
  if (input.phase === "frozen" || input.phase === "reverse_verified" || input.phase === "syncing") {
    return { ok: false as const, error: "Wedding writes are paused or a sync is already marked in progress. Nothing else was copied." };
  }
  return { ok: true as const, error: "" };
}

export function resumeDecision(phase: string, ageMs: number) {
  if (phase === "syncing" && ageMs >= 90_000) return { ok: true as const, action: "retry" as const };
  if (phase === "syncing") return { ok: false as const, error: "A sync still looks active. Wait before retrying. Nothing was started." };
  return { ok: false as const, error: "There is no interrupted sync to resume. Nothing was started." };
}

export const CONFLICT_POLICY = "One live write path. Destination-only rows are snapshotted and kept. A newer wedding timestamp is not overwritten. Ambiguous conflicts stay visible for review. Rows are removed only after an explicit archive confirmation.";

export function explainFailure(input: { action: string; provider: string; code?: string; message: string; changed: boolean }): Diagnostic {
  const message = redactSecrets(input.message || "The operation did not finish.");
  const code = input.code || "n/a";
  return {
    headline: `${input.action} did not succeed.`,
    failed: message,
    where: input.provider,
    code,
    cause: /not set|not configured|missing/i.test(message)
      ? "A required server setting is missing."
      : /permission|42501|row level/i.test(message)
        ? "The database accepted the session but refused the operation."
        : /password authentication|28P01/i.test(message)
          ? "The server credential was rejected. The form did not change it."
          : "The evidence is in the message above. No further cause is being guessed.",
    changed: input.changed ? "A non-destructive write may have started. Check the activity log before trying again." : "Nothing was switched and no rows were deleted.",
    dataSafety: input.changed ? "Existing rows were not deleted. Treat the copy as unfinished until validation passes." : "Existing data was left where it was.",
    attempted: input.action,
    canFix: /not set|not configured/i.test(message) ? "No. The server environment has to be updated, then the app published." : "Retry is available only when the message says the operation is safe to repeat.",
    next: /not set|not configured/i.test(message) ? "Set the named server variable and publish. Do not paste the secret into this page." : "Read the message, then retry only if it says nothing was changed.",
    retrySafe: !input.changed && !/authentication rejected|28P01|password authentication/i.test(`${message} ${input.code || ""}`),
  };
}
