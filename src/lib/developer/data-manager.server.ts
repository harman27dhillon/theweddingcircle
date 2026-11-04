import { randomBytes } from "node:crypto";
import { dbSource, getSql, type Sql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { readCutover, verifiedCoreRoute } from "@/lib/developer/core-route.server";
import { activeMediaDestination } from "@/lib/developer/media-destination.server";
import { env, isWorkspacePreview } from "@/lib/env.server";
import { safeSupabaseUri } from "@/lib/developer/supabase-connect";
import { probeSupabaseConnection, withSupabase, type Query } from "@/lib/developer/supabase-pool.server";
import {
  CONFLICT_POLICY,
  activateDecision,
  explainFailure,
  productionRoutes,
  redactSecrets,
  resumeDecision,
  saveConnectionDecision,
  syncDecision,
  transferDecision,
  type Diagnostic,
  type ManagerProvider,
} from "@/lib/developer/data-manager";

function jobId() {
  return randomBytes(8).toString("hex");
}

function clean(value: string) {
  return redactSecrets(value).slice(0, 400);
}

async function activitySql() {
  const sql = await getSql();
  await sql`create table if not exists developer_sync_activity (
    id text primary key,
    job_id text not null,
    provider text not null,
    action text not null,
    status text not null,
    detail text not null,
    created_at timestamptz not null default now()
  )`;
  return sql;
}

async function logActivity(sql: Sql, row: { provider: string; action: string; status: string; detail: string; jobId: string }) {
  const id = randomBytes(8).toString("hex");
  await sql`insert into developer_sync_activity (id, job_id, provider, action, status, detail) values (${id}, ${row.jobId}, ${row.provider}, ${row.action}, ${row.status}, ${clean(row.detail)})`;
}

async function recentActivity(sql: Sql) {
  try {
    const rows = await sql<{ job_id: string; provider: string; action: string; status: string; detail: string; created_at: string | Date }>`
      select job_id, provider, action, status, detail, created_at from developer_sync_activity order by created_at desc limit 12
    `;
    return rows.map((row) => ({
      jobId: row.job_id,
      provider: row.provider,
      action: row.action,
      status: row.status,
      detail: clean(row.detail),
      at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
    }));
  } catch {
    return [];
  }
}

async function readPhase(sql: Sql) {
  try {
    const rows = await sql<{ phase: string; updated_at: string | Date }>`select phase, updated_at from developer_core_migration where id = 'current' limit 1`;
    const row = rows[0];
    const stamp = row?.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row?.updated_at || ""));
    return { phase: row?.phase || "idle", ageMs: Number.isNaN(stamp) ? Number.POSITIVE_INFINITY : Date.now() - stamp };
  } catch {
    return { phase: "idle", ageMs: Number.POSITIVE_INFINITY };
  }
}

function production() {
  return !isWorkspacePreview() || Boolean(env("VERCEL"));
}

function present(name: string) {
  return Boolean(env(name));
}

async function authProbe() {
  const url = (env("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || "";
  if (!url || !key) return { state: "missing" as const, detail: "Supabase Auth was not tested because the public URL or publishable key is not set. This does not say anything about Postgres." };
  try {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    if (response.ok) return { state: "ok" as const, detail: "Supabase Auth API answered. This is not the wedding database and it does not decide routing." };
    return { state: "failed" as const, detail: "Supabase Auth API health did not succeed. Postgres is a separate check." };
  } catch {
    return { state: "failed" as const, detail: "Supabase Auth API could not be reached. Postgres is a separate check." };
  }
}

function calm(): Diagnostic {
  return {
    headline: "No failed operation in this request.",
    failed: "",
    where: "Database Manager",
    code: "",
    cause: "",
    changed: "Routing was not changed.",
    dataSafety: CONFLICT_POLICY,
    attempted: "Status refresh",
    canFix: "Nothing needs a repair from this request.",
    next: production() ? "Test a provider before treating it as connected." : "Published routing cannot be verified from this preview.",
    retrySafe: true,
  };
}

async function routeInput(neonVerified: boolean | null, supabaseVerified: boolean | null, supabaseAuth: "missing" | "untested" | "ok" | "failed", firebaseStorageVerified: boolean | null) {
  const sql = await getSql();
  const phase = await readPhase(sql);
  const cutover = production() ? await readCutover() : "neon";
  const observed = verifiedCoreRoute();
  let mediaActive: "library" | "firebase" = "library";
  try {
    mediaActive = (await activeMediaDestination(sql)) === "firebase" ? "firebase" : "library";
  } catch {
    mediaActive = "library";
  }
  return {
    flags: phase,
    cutover,
    routes: productionRoutes({
      production: production(),
      neonConfigured: dbSource === "neon",
      neonVerified,
      supabaseConfigured: (env("SUPABASE_DB_URL") || "").startsWith("postgres"),
      supabaseVerified,
      supabaseAuth,
      cutover,
      phase: phase.phase,
      observedRoute: observed?.used ?? null,
      mediaActive,
      firebaseStorageVerified,
    }),
  };
}

export async function dataManagerBoard(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await activitySql().catch(() => getSql());
  const snapshot = await routeInput(null, null, "untested", null);
  const supabaseUri = safeSupabaseUri(env("SUPABASE_DB_URL") || "");
  const activity = await recentActivity(await sql);
  return {
    ok: true as const,
    policy: CONFLICT_POLICY,
    production: production(),
    live: snapshot.routes.live,
    categories: snapshot.routes.rows,
    diagnostic: calm(),
    activity,
    recovery: [
      { title: "Retry a connection test", detail: "Safe. It does not copy rows or change routing.", needsApproval: false },
      { title: "Resume an interrupted copy", detail: "Available only when a sync has been stale for more than 90 seconds. It does not switch routing.", needsApproval: true },
      { title: "Destination-only wedding rows", detail: "They are not deleted from this screen. Inspect shows their slugs. Archive stays a separate confirmed action on the migration desk.", needsApproval: true },
    ],
    providers: [
      {
        id: "neon" as const,
        title: "Neon",
        state: dbSource === "neon" ? "configured_untested" : "not_configured",
        summary: dbSource === "neon"
          ? "The server database variable is set. The value is not shown. This is not a connection result."
          : "The server database variable is not set in this process. The preview uses the embedded database. That is not published Neon.",
        services: [
          { name: "Postgres", state: dbSource === "neon" ? "configured_untested" : "not_configured", detail: "Better Auth, media metadata, and live signaling stay here." },
        ],
      },
      {
        id: "supabase" as const,
        title: "Supabase",
        state: supabaseUri.status === "ready" ? "configured_untested" : "not_configured",
        summary: supabaseUri.detail,
        services: [
          { name: "Postgres", state: supabaseUri.status === "ready" ? "configured_untested" : "not_configured", detail: "Wedding rows can be copied here. A URI description is not a connection." },
          { name: "Auth API", state: "configured_untested", detail: "Separate from Postgres. Not tested on this refresh." },
          { name: "Storage", state: "not_configured", detail: "Wedding file bytes are not stored in Supabase Storage." },
        ],
      },
      {
        id: "firebase" as const,
        title: "Firebase",
        state: present("FIREBASE_STORAGE_BUCKET") || present("FIREBASE_PROJECT_ID") ? "configured_untested" : "not_configured",
        summary: "Firebase is not PostgreSQL and does not hold wedding rows. Storage is used only after a verified media switch. The service account is never accepted in this form.",
        services: [
          { name: "Web config", state: present("FIREBASE_API_KEY") && present("FIREBASE_PROJECT_ID") ? "configured_untested" : "not_configured", detail: present("FIREBASE_API_KEY") ? "Public web fields are present on the server or saved config. Values are not shown." : "Public web fields are not all present in this server process." },
          { name: "Storage", state: present("FIREBASE_STORAGE_BUCKET") && present("FIREBASE_SERVICE_ACCOUNT_JSON") ? "configured_untested" : "not_configured", detail: "A storage test uploads one disposable file and deletes it. Wedding files are not touched." },
          { name: "Authentication", state: "not_configured", detail: "Wedding sign-in stays on Better Auth. Firebase Auth is not the account system." },
        ],
      },
    ],
  };
}

function fail(provider: string, action: string, message: string, code = "", changed = false) {
  return { ok: false as const, error: clean(message), diagnostic: explainFailure({ action, provider, code, message, changed }) };
}

export async function dataManagerSave(token: string, provider: string, pasted: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const which = provider === "neon" || provider === "supabase" || provider === "firebase" ? provider : "";
  if (!which) return fail("database", "Save connection", "That provider is not Neon, Supabase, or Firebase.");
  const decision = saveConnectionDecision({ provider: which, pasted, confirm });
  const sql = await activitySql();
  const id = jobId();
  if (!decision.ok) {
    await logActivity(sql, { provider: which, action: "save", status: "blocked", detail: decision.error, jobId: id });
    return fail(which, "Save connection", decision.error);
  }
  await logActivity(sql, { provider: which, action: "save", status: "saved", detail: decision.message, jobId: id });
  return { ok: true as const, message: decision.message, persist: decision.persist, diagnostic: calm(), jobId: id };
}

export async function dataManagerTest(token: string, provider: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await activitySql();
  const id = jobId();
  if (provider === "neon") {
    try {
      const db = await getSql();
      const rows = await db.query<{ ok: number }>("select 1 as ok");
      const embedded = dbSource !== "neon";
      const detail = embedded
        ? "The embedded database answered select 1. This is not the published Neon database, and routing was not changed."
        : "Neon answered select 1. No rows were copied and routing was not changed.";
      if (Number(rows[0]?.ok) !== 1) throw new Error("The database did not return the expected read.");
      await logActivity(sql, { provider: "neon", action: "test", status: embedded ? "embedded" : "connected", detail, jobId: id });
      return { ok: true as const, message: detail, diagnostic: calm(), jobId: id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The current database could not be read.";
      await logActivity(sql, { provider: "neon", action: "test", status: "failed", detail: message, jobId: id });
      return fail("Neon Postgres", "Test connection", message);
    }
  }
  if (provider === "supabase") {
    const probe = await probeSupabaseConnection();
    const auth = await authProbe();
    const postgresOk = probe.status === "connected";
    const detail = `Postgres: ${probe.detail} Auth API: ${auth.detail}`;
    await logActivity(sql, { provider: "supabase", action: "test", status: postgresOk ? "connected" : probe.status, detail, jobId: id });
    if (!postgresOk) return fail("Supabase Postgres", "Test connection", probe.detail, probe.code || probe.status);
    return { ok: true as const, message: detail, auth: auth.state, diagnostic: calm(), jobId: id };
  }
  if (provider === "firebase") {
    if (!present("FIREBASE_SERVICE_ACCOUNT_JSON") || !present("FIREBASE_STORAGE_BUCKET")) {
      const message = "Firebase Storage is not configured. Set the storage bucket and the server service-account variable, then publish. No file was uploaded and wedding rows were not copied.";
      await logActivity(sql, { provider: "firebase", action: "test", status: "not_configured", detail: message, jobId: id });
      return fail("Firebase Storage", "Test connection", message);
    }
    const { probeFirebaseStorage } = await import("@/lib/developer/firebase-storage.server");
    const probe = await probeFirebaseStorage();
    await logActivity(sql, { provider: "firebase", action: "test", status: probe.ok ? "connected" : "failed", detail: probe.detail, jobId: id });
    if (!probe.ok) return fail("Firebase Storage", "Test connection", probe.detail);
    return { ok: true as const, message: probe.detail, diagnostic: calm(), jobId: id };
  }
  return fail("database", "Test connection", "That provider is not Neon, Supabase, or Firebase.");
}

async function compareLive() {
  if (dbSource !== "neon") return { ok: false as const, error: "This process is not the published Neon database. The live tables were not compared." };
  if (!(env("SUPABASE_DB_URL") || "").startsWith("postgres")) return { ok: false as const, error: "The Supabase database variable is not set. Nothing was compared." };
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const { auditPair } = await import("@/lib/developer/core-reconcile");
  const wrapped = await withSupabase(async (query) => {
    const audit = await auditPair(neon, query);
    const left = await neon(`select slug from public.circles`);
    const right = await query(`select slug from public.circles`);
    const have = new Set(left.map((row) => String(row.slug || "")));
    const there = new Set(right.map((row) => String(row.slug || "")));
    const extras = [...there].filter((slug) => slug && !have.has(slug)).slice(0, 20);
    const missing = [...have].filter((slug) => slug && !there.has(slug)).slice(0, 20);
    return { audit, extras, missing };
  });
  if (wrapped && typeof wrapped === "object" && "ok" in wrapped && wrapped.ok === false && "error" in wrapped) {
    return { ok: false as const, error: String(wrapped.error) };
  }
  return { ok: true as const, report: wrapped as { audit: Awaited<ReturnType<typeof auditPair>>; extras: string[]; missing: string[] } };
}

export async function dataManagerInspect(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await activitySql();
  const id = jobId();
  const compared = await compareLive();
  if (!compared.ok) {
    await logActivity(sql, { provider: "supabase", action: "inspect", status: "blocked", detail: compared.error, jobId: id });
    return fail("Supabase Postgres", "Inspect database", compared.error);
  }
  const audit = compared.report.audit;
  const detail = `${audit.error || "Inspection matched the checked wedding fields."} Destination-only slugs: ${compared.report.extras.join(", ") || "none"}. Missing slugs: ${compared.report.missing.join(", ") || "none"}. Nothing was copied.`;
  await logActivity(sql, { provider: "supabase", action: "inspect", status: audit.ok ? "matched" : "conflict", detail, jobId: id });
  return {
    ok: true as const,
    message: clean(detail),
    extras: compared.report.extras,
    missing: compared.report.missing,
    conflicts: audit.valueConflicts,
    extraRows: audit.extraRows,
    publicClosed: audit.publicClosed,
    serverAccessOk: audit.serverAccessOk,
    diffs: audit.diffs,
    diagnostic: audit.ok ? calm() : explainFailure({ action: "Inspect database", provider: "Supabase Postgres", message: audit.error, changed: false }),
    jobId: id,
  };
}

export async function dataManagerTransfer(token: string, source: string, destination: string, execute: boolean, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const from = source as ManagerProvider;
  const to = destination as ManagerProvider;
  const sql = await activitySql();
  const id = jobId();
  const compared = source !== "firebase" && destination !== "firebase" && dbSource === "neon" ? await compareLive() : null;
  const audit = compared && compared.ok ? compared.report.audit : null;
  const decision = transferDecision({
    source: from,
    destination: to,
    execute,
    confirm,
    productionSource: dbSource === "neon",
    extras: audit?.extraRows ?? 0,
    conflicts: audit?.valueConflicts ?? 0,
    missing: audit?.missingRows ?? 0,
  });
  if (!decision.ok) {
    await logActivity(sql, { provider: `${source}->${destination}`, action: "transfer", status: "blocked", detail: decision.error, jobId: id });
    return fail("Transfer", "Transfer data", decision.error || "Transfer is blocked.");
  }
  if (decision.mode === "preview") {
    if (!compared || !compared.ok) {
      await logActivity(sql, { provider: "transfer", action: "preview", status: "blocked", detail: compared?.error || "Nothing was compared.", jobId: id });
      return fail("Transfer", "Transfer preview", compared && !compared.ok ? compared.error : "Nothing was compared.");
    }
    const detail = `Preview only. Destination-only slugs: ${compared.report.extras.join(", ") || "none"}. Field conflicts: ${audit?.valueConflicts ?? 0}. Missing: ${compared.report.missing.join(", ") || "none"}. Nothing was copied and routing was not changed.`;
    await logActivity(sql, { provider: "transfer", action: "preview", status: "preview", detail, jobId: id });
    return { ok: true as const, message: clean(detail), diffs: audit?.diffs ?? [], diagnostic: calm(), jobId: id };
  }
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const { reconcilePair } = await import("@/lib/developer/core-reconcile");
  const wrapped = await withSupabase(async (query) => ({ reconciled: await reconcilePair(neon, query) }));
  if (wrapped && typeof wrapped === "object" && "ok" in wrapped && wrapped.ok === false && "error" in wrapped && !("reconciled" in wrapped)) {
    await logActivity(sql, { provider: "transfer", action: "copy", status: "failed", detail: String(wrapped.error), jobId: id });
    return fail("Transfer", "Transfer data", String(wrapped.error), "", true);
  }
  const reconciled = (wrapped as { reconciled: { ok: boolean; error?: string; copied?: number; preserved?: number } }).reconciled;
  const detail = reconciled.ok
    ? `Copied ${reconciled.copied ?? 0} source rows. Preserved snapshots: ${reconciled.preserved ?? 0}. Routing was not changed.`
    : String(reconciled.error || "The copy did not pass validation. Routing was not changed.");
  await logActivity(sql, { provider: "transfer", action: "copy", status: reconciled.ok ? "copied" : "conflict", detail, jobId: id });
  if (!reconciled.ok) return fail("Transfer", "Transfer data", detail, "", true);
  return { ok: true as const, message: clean(detail), diagnostic: calm(), jobId: id };
}

export async function dataManagerSync(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await activitySql();
  const phase = await readPhase(sql);
  const snapshot = await routeInput(null, null, "untested", null);
  const writer = !production() || dbSource !== "neon" ? snapshot.routes.live : snapshot.cutover;
  const decision = syncDecision({ confirm, live: writer === "supabase" ? "supabase" : writer === "neon" ? "neon" : snapshot.routes.live, phase: phase.phase, productionSource: dbSource === "neon" });
  const id = jobId();
  if (!decision.ok) {
    await logActivity(sql, { provider: "sync", action: "sync", status: "blocked", detail: decision.error, jobId: id });
    return fail("SmartSync", "Sync now", decision.error);
  }
  return dataManagerTransfer(token, "neon", "supabase", true, true);
}

export async function dataManagerResume(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return fail("Recovery", "Resume sync", "Resume stays off until you confirm it. Nothing was started.");
  const sql = await activitySql();
  const phase = await readPhase(sql);
  const decision = resumeDecision(phase.phase, phase.ageMs);
  if (!decision.ok) return fail("Recovery", "Resume sync", decision.error);
  return dataManagerTransfer(token, "neon", "supabase", true, true);
}

export async function dataManagerActivate(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const compared = await compareLive();
  if (!compared.ok) return fail("Activation", "Change production routing", compared.error);
  const audit = compared.report.audit;
  const decision = activateDecision({
    confirm,
    auditOk: audit.ok,
    extras: audit.extraRows,
    conflicts: audit.valueConflicts,
    missing: audit.missingRows,
    publicClosed: audit.publicClosed,
    serverAccessOk: audit.serverAccessOk,
    orphanInvites: audit.orphanInvites,
    duplicateIds: audit.duplicateIds,
  });
  const sql = await activitySql();
  const id = jobId();
  if (!decision.ok) {
    await logActivity(sql, { provider: "routing", action: "activate", status: "blocked", detail: decision.error, jobId: id });
    return fail("Activation", "Change production routing", decision.error);
  }
  const { cutoverCoreMigration } = await import("@/lib/developer/core-migration.server");
  const result = await cutoverCoreMigration(token, true);
  const message = result.ok ? "Activation was requested. The board below is the saved result, not a guess." : ("error" in result ? result.error : "Activation did not return a board.");
  await logActivity(sql, { provider: "routing", action: "activate", status: result.ok ? "recorded" : "blocked", detail: message, jobId: id });
  if (!result.ok) return fail("Activation", "Change production routing", "error" in result ? result.error : "Activation did not succeed.");
  return { ok: true as const, message: "The cutover flag was updated only after the checks in the migration service passed. Confirm the routing panel before trusting it.", diagnostic: calm(), jobId: id };
}
