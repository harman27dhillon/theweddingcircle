import { getSql, dbSource, type Sql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import {
  AUTH_NOTE,
  CORE_COLUMNS,
  CORE_PRIMARY_KEYS,
  CORE_TABLES,
  MEDIA_NOTE,
  ROLLBACK_NOTE,
  SETUP_NOTE,
  SUPABASE_CORE_CONSTRAINTS,
  SUPABASE_CORE_SQL,
  compareCoreRows,
  compareCounts,
  decideCoreCutover,
  decideRollback,
  decideUnfreeze,
  reviewRls,
  schemaLooksSafe,
  shouldAutoActivate,
  upsertConflict,
  writesPaused,
  type CoreTable,
} from "@/lib/developer/core-migration";
import { archiveDestinationOnly, auditPair, reconcilePair } from "@/lib/developer/core-reconcile";
import { invalidateCutoverCache, readCutover } from "@/lib/developer/core-route.server";
import { safeSupabaseUri } from "@/lib/developer/supabase-connect";
import { probeSupabaseConnection, withSupabase, type Query } from "@/lib/developer/supabase-pool.server";
import { env } from "@/lib/env.server";
import { redactCloud } from "@/lib/developer/cloud";
import { duplicateMessageIds } from "@/lib/wedding/offline";

type Counts = Record<string, number>;
type ColumnInfo = { table: string; name: string; dataType: string; udt: string };

const emptyCounts = () => Object.fromEntries(CORE_TABLES.map((table) => [table, 0])) as Counts;

const JSON_COLUMNS = new Set(["payload", "ceremonies"]);

async function stateSql() {
  const sql = await getSql();
  await sql`create table if not exists developer_core_migration (
    id text primary key,
    phase text not null default 'idle',
    detail text not null default '',
    source_counts jsonb not null default '{}',
    target_counts jsonb not null default '{}',
    cutover text not null default 'neon',
    validated boolean not null default false,
    updated_at timestamptz not null default now()
  )`;
  await sql`alter table developer_core_migration add column if not exists target_reachable boolean not null default false`;
  return sql;
}

function asCounts(value: unknown): Counts {
  const counts = emptyCounts();
  if (!value || typeof value !== "object") return counts;
  for (const table of CORE_TABLES) {
    const raw = (value as Record<string, unknown>)[table];
    counts[table] = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }
  return counts;
}

async function readState(sql: Sql) {
  const rows = await sql<{
    phase: string;
    detail: string;
    source_counts: unknown;
    target_counts: unknown;
    cutover: string;
    validated: boolean;
    target_reachable: boolean;
    updated_at: string | Date;
  }>`select phase, detail, source_counts, target_counts, cutover, validated, target_reachable, updated_at from developer_core_migration where id = 'current' limit 1`;
  return rows[0] ?? null;
}

function secretValues() {
  return [env("SUPABASE_DB_URL") || "", env("SUPABASE_SERVICE_ROLE_KEY") || "", env("DATABASE_URL") || ""].filter((item) => item.length > 6);
}

async function writeState(sql: Sql, patch: { phase: string; detail: string; source?: Counts; target?: Counts; cutover?: string; validated?: boolean; targetReachable?: boolean }) {
  const current = await readState(sql);
  const source = JSON.stringify(patch.source ?? asCounts(current?.source_counts));
  const target = JSON.stringify(patch.target ?? asCounts(current?.target_counts));
  const cutover = patch.cutover ?? current?.cutover ?? "neon";
  const validated = patch.validated ?? Boolean(current?.validated);
  const targetReachable = patch.targetReachable ?? Boolean(current?.target_reachable);
  const detail = redactCloud(patch.detail, secretValues()).slice(0, 500);
  await sql`insert into developer_core_migration (id, phase, detail, source_counts, target_counts, cutover, validated, target_reachable, updated_at)
    values ('current', ${patch.phase}, ${detail}, ${source}::jsonb, ${target}::jsonb, ${cutover}, ${validated}, ${targetReachable}, now())
    on conflict (id) do update set
      phase = excluded.phase,
      detail = excluded.detail,
      source_counts = excluded.source_counts,
      target_counts = excluded.target_counts,
      cutover = excluded.cutover,
      validated = excluded.validated,
      target_reachable = excluded.target_reachable,
      updated_at = now()`;
  invalidateCutoverCache();
}

function dbUrlConfigured() {
  return (env("SUPABASE_DB_URL") || "").startsWith("postgres");
}

function serviceRoleConfigured() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  return key.length > 20;
}

function isFailure(value: unknown): value is { ok: false; error: string } {
  return Boolean(value && typeof value === "object" && "ok" in value && (value as { ok?: boolean }).ok === false && typeof (value as { error?: unknown }).error === "string");
}

function missingRelation(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "42P01" || /does not exist/i.test(message);
}

function countSentence(counts: Counts) {
  return CORE_TABLES.map((table) => `${table} ${counts[table] < 0 ? "missing" : counts[table]}`).join(", ");
}

async function countTables(query: Query) {
  const counts = emptyCounts();
  for (const table of CORE_TABLES) {
    try {
      const rows = await query(`select count(*)::int as n from public.${table}`);
      counts[table] = Number(rows[0]?.n ?? 0);
    } catch (error) {
      if (!missingRelation(error)) throw error;
      counts[table] = -1;
    }
  }
  return counts;
}

async function sourceCounts() {
  const sql = await getSql();
  return countTables((text, params) => sql.query(text, params));
}

function ident(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : "";
}

function sqlType(dataType: string, udt: string) {
  const type = dataType.toLowerCase();
  const kind = udt.toLowerCase();
  if (kind === "jsonb" || type === "jsonb" || kind === "json" || type === "json") return "jsonb";
  if (type === "text" || kind === "text" || type === "character varying" || type === "character") return "text";
  if (type.includes("timestamp")) return "timestamptz";
  if (type === "boolean" || kind === "bool") return "boolean";
  if (type === "integer" || kind === "int4") return "integer";
  if (type === "bigint" || kind === "int8") return "bigint";
  if (type === "numeric" || kind === "numeric") return "numeric";
  if (type === "uuid" || kind === "uuid") return "uuid";
  return "";
}

async function readColumns(query: Query): Promise<ColumnInfo[]> {
  const rows = await query(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public'`);
  return rows
    .map((row) => ({
      table: String(row.table_name || ""),
      name: String(row.column_name || ""),
      dataType: String(row.data_type || ""),
      udt: String(row.udt_name || ""),
    }))
    .filter((column) => (CORE_TABLES as readonly string[]).includes(column.table) && ident(column.name));
}

async function sourceColumns() {
  const sql = await getSql();
  return readColumns((text, params) => sql.query(text, params));
}

function credentialColumn(name: string) {
  return /password|session|secret/i.test(name);
}

async function alignColumns(query: Query, columns: ColumnInfo[]) {
  for (const column of columns) {
    if (!ident(column.table) || credentialColumn(column.name)) {
      if (credentialColumn(column.name)) {
        return { ok: false as const, error: `Source column ${column.table}.${column.name} was not copied because it looks like a credential. Traffic did not move.` };
      }
      continue;
    }
    const known = await query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [column.table, column.name],
    );
    if (known.length) continue;
    const type = sqlType(column.dataType, column.udt);
    if (!type) {
      return { ok: false as const, error: `Source column ${column.table}.${column.name} uses ${column.dataType}, which this migration will not guess. Nothing further was changed and traffic did not move.` };
    }
    await query(`alter table public.${column.table} add column if not exists ${column.name} ${type}`);
  }
  return { ok: true as const };
}

function jsonValue(value: unknown) {
  if (value == null) return "{}";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function copyRows(query: Query, table: CoreTable, columns: string[], rows: Record<string, unknown>[], mode: "forward" | "reverse") {
  if (!rows.length) return 0;
  const conflict = upsertConflict(table, columns, mode);
  const placeholders = columns.map((column, index) => (JSON_COLUMNS.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`)).join(", ");
  const statement = `insert into public.${table} (${columns.join(", ")}) values (${placeholders}) ${conflict}`;
  for (const row of rows) {
    await query(statement, columns.map((column) => (JSON_COLUMNS.has(column) ? jsonValue(row[column]) : row[column])));
  }
  return rows.length;
}

async function copyCore(from: Query, to: Query, mode: "forward" | "reverse") {
  const fromShape = await readColumns(from);
  const destination = await readColumns(to);
  let copied = 0;
  for (const table of CORE_TABLES) {
    const sourceNames = fromShape.filter((column) => column.table === table).map((column) => column.name);
    const columns = CORE_COLUMNS[table].filter((column) => sourceNames.includes(column) && destination.some((item) => item.table === table && item.name === column));
    if (!columns.length) {
      if (!sourceNames.length) continue;
      const error = new Error(`public.${table} is missing on the destination.`) as Error & { code?: string };
      error.code = "42P01";
      throw error;
    }
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await from(`select ${columns.join(", ")} from public.${table}`);
    } catch (error) {
      if (missingRelation(error)) continue;
      throw error;
    }
    copied += await copyRows(to, table, [...columns], rows, mode);
  }
  return copied;
}

function statements() {
  return SUPABASE_CORE_SQL.split(";").map((item) => item.trim()).filter(Boolean);
}

function constraintExists(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "42710" || code === "42704" || /already exists/i.test(message);
}

async function applyConstraints(query: Query) {
  for (const statement of SUPABASE_CORE_CONSTRAINTS) {
    try {
      await query(statement);
    } catch (error) {
      if (constraintExists(error)) continue;
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
      if (code === "23503") return { ok: false as const, error: "A wedding link could not be added because some rows point at a missing wedding. Nothing was switched." };
      const message = error instanceof Error ? error.message : "The wedding link could not be added.";
      return { ok: false as const, error: message.slice(0, 240) };
    }
  }
  return { ok: true as const };
}

async function publicProbe() {
  const { activeSupabasePublic } = await import("@/lib/developer/cloud.server");
  const saved = await activeSupabasePublic().catch(() => ({ projectUrl: "", publishableKey: "" }));
  const url = (saved.projectUrl || env("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = saved.publishableKey || env("SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY") || "";
  if (!url || !key) return { state: "not_configured" as const, detail: "The public Supabase URL and publishable key are not both saved. This does not say anything about the database password in SUPABASE_DB_URL." };
  try {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    if (response.ok) return { state: "connected" as const, detail: "Supabase Auth API answered using the saved public key. This is not the wedding database and it does not decide routing." };
    return { state: "error" as const, detail: "Supabase Auth API health check did not succeed. The wedding database uses SUPABASE_DB_URL and is checked separately. The key was not shown." };
  } catch {
    return { state: "error" as const, detail: "Supabase Auth API could not be reached. The wedding database is checked separately and this result does not move traffic." };
  }
}

function sourceLabel() {
  if (dbSource === "supabase") return "Supabase Postgres";
  return dbSource === "neon" ? "Neon Postgres" : "Embedded Postgres";
}

function connectionSummary() {
  return safeSupabaseUri(env("SUPABASE_DB_URL") || "").detail;
}

function alternateSecrets() {
  const names = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "SUPABASE_DATABASE_URL", "DIRECT_URL"].filter((name) => Boolean(env(name)));
  if (!names.length) return "No other database URL is set in this server process. Supabase Postgres reads only SUPABASE_DB_URL.";
  return `These variables are set and are not used for Supabase: ${names.join(", ")}. DATABASE_URL stays the Neon connection. Supabase reads only SUPABASE_DB_URL.`;
}

export async function probeCoreConnection(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const cutover = await readCutover();
  const probe = await probeSupabaseConnection();
  return {
    ok: true as const,
    probe,
    cutover,
    alternates: alternateSecrets(),
    migrated: false as const,
  };
}

export async function coreMigrationBoard(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const row = await readState(sql);
  const probe = await probeSupabaseConnection();
  const cutover = await readCutover();
  const phase = row?.phase || "idle";
  const liveDatabase = cutover === "supabase" ? "Supabase Postgres" : sourceLabel();
  const liveWrites = writesPaused(phase) ? `${liveDatabase}; writes are paused` : liveDatabase;
  const source = asCounts(row?.source_counts);
  const target = asCounts(row?.target_counts);
  let audit: Awaited<ReturnType<typeof auditPair>> | null = null;
  if (probe.status === "connected" && dbSource === "neon") {
    const origin = await getSql();
    const neon: Query = (text, params) => origin.query(text, params);
    const wrapped = await withSupabase(async (query) => ({ audit: await auditPair(neon, query) }));
    if (!isFailure(wrapped)) audit = wrapped.audit;
  }
  const targetReachable = audit ? true : Boolean(row?.target_reachable);
  const comparisonSource = audit ? asCounts(audit.source) : source;
  const comparisonTarget = audit ? asCounts(audit.target) : target;
  return {
    ok: true as const,
    sourceLabel: sourceLabel(),
    activeSource: liveDatabase,
    liveWrites,
    cutover,
    routeReason: cutover === "supabase"
      ? probe.status === "connected"
        ? writesPaused(phase)
          ? "Live wedding reads use Supabase. Writes are paused. Account sign-in and media files stay on the current database."
          : "Live wedding reads and writes use Supabase. Account sign-in and media files stay on the current database."
        : "The routing flag says Supabase, but this Postgres read did not succeed. The previous database was not used in its place."
      : "Live wedding reads and writes use the current database. Supabase is not serving wedding requests.",
    databaseProbe: {
      state: probe.status,
      tested: probe.tested,
      detail: probe.detail,
    },
    authApi: await publicProbe(),
    serviceRoleConfigured: serviceRoleConfigured(),
    dbUrlConfigured: dbUrlConfigured(),
    connectionSummary: connectionSummary(),
    phase,
    detail: redactCloud(row?.detail || "No migration has been run.", secretValues()),
    validated: Boolean(row?.validated),
    sourceCounts: comparisonSource,
    targetCounts: comparisonTarget,
    targetReachable,
    comparison: compareCounts(comparisonSource, comparisonTarget, targetReachable),
    auditSummary: audit ? (audit.ok ? "Field, relationship, public-access, and server-access checks passed. This label alone is not the cutover." : audit.error) : "The wedding tables were not compared in this request.",
    publicClosed: audit ? audit.publicClosed : null,
    serverAccessOk: audit ? audit.serverAccessOk : null,
    extraRows: audit ? audit.extraRows : null,
    valueConflicts: audit ? audit.valueConflicts : null,
    diffs: audit?.diffs ?? [],
    authNote: AUTH_NOTE,
    mediaNote: MEDIA_NOTE,
    setupNote: SETUP_NOTE,
    rollbackNote: ROLLBACK_NOTE,
    schemaReady: schemaLooksSafe(SUPABASE_CORE_SQL),
    tables: CORE_TABLES,
  };
}

export async function inspectCoreMigration(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const source = await sourceCounts();
  const counted = await withSupabase(async (query) => countTables(query));
  if (isFailure(counted)) {
    await writeState(sql, { phase: "needs_setup", detail: counted.error, source, targetReachable: false, validated: false });
    return { ok: false as const, error: counted.error };
  }
  const missing = CORE_TABLES.filter((table) => counted[table] < 0);
  const detail = missing.length
    ? `Connected to Supabase. Current database: ${countSentence(source)}. Supabase: ${countSentence(counted)}. Missing tables are not a connection failure. No rows were copied and traffic did not move.`
    : `Connected to Supabase. Current database: ${countSentence(source)}. Supabase: ${countSentence(counted)}. No rows were copied and traffic did not move.`;
  await writeState(sql, { phase: "inspected", detail, source, target: counted, targetReachable: true, validated: false });
  return coreMigrationBoard(token);
}

export async function prepareCoreMigration(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Schema preparation stays off until you confirm it. No database was changed." };
  if (!schemaLooksSafe(SUPABASE_CORE_SQL)) return { ok: false as const, error: "The prepared schema was refused. Nothing was changed." };
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const source = await sourceCounts();
  const prepared = await withSupabase(async (query) => {
    for (const statement of statements()) {
      try {
        await query(statement);
      } catch (error) {
        if (constraintExists(error)) continue;
        throw error;
      }
    }
    const linked = await applyConstraints(query);
    if (!linked.ok) return linked;
    const aligned = await alignColumns(query, await sourceColumns());
    if (!aligned.ok) return aligned;
    return { ok: true as const, target: await countTables(query) };
  });
  if (isFailure(prepared)) {
    await writeState(sql, { phase: "needs_setup", detail: prepared.error, source, targetReachable: false, validated: false });
    return { ok: false as const, error: prepared.error };
  }
  await writeState(sql, {
    phase: "prepared",
    detail: "Supabase tables were created or already existed. No wedding rows were copied. Row Level Security is on and there is no public policy. Traffic did not move.",
    source,
    target: prepared.target,
    targetReachable: true,
    validated: false,
  });
  return coreMigrationBoard(token);
}

export async function runCoreMigration(token: string, confirm: boolean, dryRun: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!dryRun && !confirm) return { ok: false as const, error: "The copy stays off until you confirm it. The current database was not changed." };
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const source = await sourceCounts();
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const result = await withSupabase(async (query) => {
    if (dryRun) return { dryRun: true as const, target: await countTables(query), copied: 0 };
    const reconciled = await reconcilePair(neon, query);
    return { dryRun: false as const, reconciled };
  });
  if (isFailure(result)) {
    await writeState(sql, { phase: "error", detail: result.error, source, targetReachable: false, validated: false });
    return { ok: false as const, error: result.error };
  }
  let target: Counts;
  let copied = 0;
  if (result.dryRun) {
    target = result.target;
  } else if (!result.reconciled.ok) {
    await writeState(sql, {
      phase: "invalid",
      detail: result.reconciled.error,
      source: result.reconciled.source ? asCounts(result.reconciled.source) : source,
      target: result.reconciled.target ? asCounts(result.reconciled.target) : undefined,
      targetReachable: true,
      validated: false,
    });
    return { ok: false as const, error: result.reconciled.error };
  } else {
    target = result.reconciled.target;
    copied = result.reconciled.copied;
  }
  const comparison = compareCounts(source, target, true);
  const missing = CORE_TABLES.filter((table) => target[table] < 0);
  const detail = result.dryRun
    ? `Dry run only. Current database: ${countSentence(source)}. Supabase: ${countSentence(target)}. ${missing.length ? "Prepare the missing tables before copying." : "No rows were written."} Traffic did not move.`
    : `Upserted ${copied} source rows into Supabase and kept destination-only rows. Current database: ${countSentence(source)}. Supabase: ${countSentence(target)}. The current database was not modified. Traffic did not move.`;
  await writeState(sql, { phase: result.dryRun ? "dry_run" : "copied", detail, source, target, targetReachable: true, validated: false });
  return { ...(await coreMigrationBoard(token)), copied, countsMatch: comparison.ok };
}

async function readCoreTable(query: Query, table: CoreTable) {
  try {
    return await query(`select ${CORE_COLUMNS[table].join(", ")} from public.${table}`);
  } catch (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
}

async function fieldCompare(neon: Query, supabase: Query) {
  let total = 0;
  for (const table of CORE_TABLES) {
    const left = await readCoreTable(neon, table);
    const right = await readCoreTable(supabase, table);
    if (!left || !right) {
      total += 1;
      continue;
    }
    total += compareCoreRows(table, left, right).diffs.length;
  }
  return { ok: total === 0, total };
}

async function readRls(query: Query) {
  try {
    const tables = await query(
      `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1::text[])`,
      [[...CORE_TABLES]],
    );
    const policies = await query(
      `select tablename as table, roles::text as roles from pg_policies where schemaname = 'public' and tablename = any($1::text[])`,
      [[...CORE_TABLES]],
    );
    return reviewRls({
      tables: tables.map((row) => ({ name: String(row.name || ""), rls: row.rls === true || row.rls === "t" || row.rls === "true" })),
      policies: policies.map((row) => ({ table: String(row.table || ""), roles: String(row.roles || "") })),
    });
  } catch (error) {
    if (missingRelation(error)) return { ok: false as const, problems: ["Row level security could not be read."] };
    throw error;
  }
}

async function refuseIfPaused(sql: Sql) {
  const row = await readState(sql);
  if (!row || !writesPaused(row.phase)) return null;
  return { ok: false as const, error: "Wedding writes are paused for a rollback check. Finish that check, or resume writes, before another migration step. Nothing was switched." };
}

async function validateTarget() {
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  return withSupabase(async (query) => {
    const target = await countTables(query);
    let orphanInvites = 0;
    try {
      const orphans = await query(`select count(*)::int as n from public.ceremony_invites i left join public.circles c on c.slug = i.slug where c.slug is null`);
      orphanInvites = Number(orphans[0]?.n ?? 0);
    } catch (error) {
      if (!missingRelation(error)) throw error;
      orphanInvites = -1;
    }
    let payloads: unknown[] = [];
    try {
      const rows = await query(`select payload from public.circles`);
      payloads = rows.map((row) => row.payload);
    } catch (error) {
      if (!missingRelation(error)) throw error;
      payloads = [];
    }
    const fields = await fieldCompare(neon, query);
    const rls = await readRls(query);
    return {
      target,
      orphanInvites,
      duplicateIds: duplicateMessageIds(payloads).length,
      fieldCompareOk: fields.ok,
      fieldDiffs: fields.total,
      rlsOk: rls.ok,
      rlsProblems: rls.problems,
    };
  });
}

export async function validateCoreMigration(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const source = await sourceCounts();
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const wrapped = await withSupabase(async (query) => ({ audit: await auditPair(neon, query) }));
  if (isFailure(wrapped)) {
    await writeState(sql, { phase: "error", detail: wrapped.error, source, targetReachable: false, validated: false });
    return { ok: false as const, error: wrapped.error };
  }
  const checked = wrapped.audit;
  const detail = checked.ok
    ? "Validation matched every core field. Public access is closed. The server connection can read and write the wedding tables. Traffic has not moved."
    : checked.error;
  await writeState(sql, { phase: checked.ok ? "validated" : "invalid", detail, source: asCounts(checked.source), target: asCounts(checked.target), targetReachable: true, validated: checked.ok });
  return coreMigrationBoard(token);
}

export async function cutoverCoreMigration(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const row = await readState(sql);
  if (!confirm) return { ok: false as const, error: "Cutover stays off until you confirm it. The current database is still serving wedding data." };
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const wrapped = await withSupabase(async (query) => ({ audit: await auditPair(neon, query) }));
  if (isFailure(wrapped)) return wrapped;
  const checked = wrapped.audit;
  if (!checked.ok || !checked.publicClosed || !checked.serverAccessOk) {
    await writeState(sql, {
      phase: "invalid",
      detail: checked.error || "Validation has not passed. Wedding traffic stays on the current database.",
      source: asCounts(checked.source),
      target: asCounts(checked.target),
      targetReachable: true,
      validated: false,
      cutover: row?.cutover === "supabase" ? "supabase" : "neon",
    });
    return { ok: false as const, error: checked.error || "Validation has not passed. Wedding traffic stays on the current database." };
  }
  const decision = decideCoreCutover({
    confirm,
    validated: true,
    countsMatch: true,
    fieldCompareOk: true,
    dbUrlConfigured: dbUrlConfigured(),
    duplicateIds: checked.duplicateIds,
    orphanInvites: checked.orphanInvites,
  });
  if (!decision.ok) return decision;
  await writeState(sql, {
    phase: "cutover",
    detail: "Wedding records, memberships, ceremony invitations and couple seats now read from Supabase. The current database was not deleted. Media files and account sign-in stayed where they were.",
    source: asCounts(checked.source),
    target: asCounts(checked.target),
    targetReachable: true,
    cutover: "supabase",
    validated: true,
  });
  return coreMigrationBoard(token);
}

type Activation = { ok: true } | { ok: false; kind: "blocked" | "unavailable"; error: string };

function stampAge(value: unknown) {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : Date.now() - time;
}

const activationGlobal = globalThis as typeof globalThis & { __wcCoreActivate__?: Promise<Activation> };

async function runProductionCutover(): Promise<Activation> {
  if (dbSource !== "neon" || !dbUrlConfigured()) {
    return { ok: false, kind: "unavailable", error: "The published server cannot see both databases. Wedding traffic was not switched." };
  }
  let sql: Sql;
  try {
    sql = await stateSql();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The current database could not be read.";
    return { ok: false, kind: "unavailable", error: message.slice(0, 240) };
  }
  const row = await readState(sql);
  if (row?.cutover === "supabase" && row.validated) return { ok: true };
  if (row && !shouldAutoActivate(row.cutover, row.phase)) {
    return { ok: false, kind: "blocked", error: "Wedding traffic is on the current database after a verified rollback. It was not switched again." };
  }
  if (row?.phase === "syncing" && stampAge(row.updated_at) < 90_000) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const again = await readState(sql);
    if (again?.cutover === "supabase" && again.validated) return { ok: true };
    if (again?.phase === "syncing" && stampAge(again.updated_at) < 90_000) {
      return { ok: false, kind: "blocked", error: "Wedding records are still being reconciled. Traffic stayed on the current database." };
    }
  }
  await writeState(sql, {
    phase: "syncing",
    detail: "Copying the latest wedding rows. Writes wait until the check finishes. Nothing was deleted from the current database.",
    cutover: "neon",
    validated: false,
  });
  const origin = await getSql();
  const source: Query = (text, params) => origin.query(text, params);
  const wrapped = await withSupabase(async (query) => ({ reconciled: await reconcilePair(source, query) }));
  if (isFailure(wrapped)) {
    await writeState(sql, { phase: "invalid", detail: wrapped.error, cutover: "neon", validated: false, targetReachable: false });
    return { ok: false, kind: "unavailable", error: wrapped.error };
  }
  const result = wrapped.reconciled;
  if (!result.ok) {
    await writeState(sql, {
      phase: "invalid",
      detail: result.error,
      source: result.source ? asCounts(result.source) : undefined,
      target: result.target ? asCounts(result.target) : undefined,
      cutover: "neon",
      validated: false,
      targetReachable: true,
    });
    return { ok: false, kind: "blocked", error: result.error };
  }
  await writeState(sql, {
    phase: "cutover",
    detail: "Wedding records, memberships, access codes, invitations, couple seats, and chat now use Supabase. The current database was kept. Media files and account sign-in stayed where they were.",
    source: asCounts(result.source),
    target: asCounts(result.target),
    cutover: "supabase",
    validated: true,
    targetReachable: true,
  });
  return { ok: true };
}

/** Reconcile Neon into Supabase and switch wedding traffic only after the checks pass. */
export function activateProductionCutover() {
  if (!activationGlobal.__wcCoreActivate__) {
    const run = runProductionCutover().then((result) => {
      if (!result.ok) {
        const timer = setTimeout(() => {
          if (activationGlobal.__wcCoreActivate__ === run) activationGlobal.__wcCoreActivate__ = undefined;
        }, 30_000);
        timer.unref?.();
      } else if (activationGlobal.__wcCoreActivate__ === run) {
        activationGlobal.__wcCoreActivate__ = undefined;
      }
      return result;
    });
    activationGlobal.__wcCoreActivate__ = run;
  }
  return activationGlobal.__wcCoreActivate__;
}

export async function archiveExtraCoreRows(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Supabase-only rows stay in place until you confirm the recovery archive. Nothing was removed." };
  const sql = await stateSql();
  const paused = await refuseIfPaused(sql);
  if (paused) return paused;
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const wrapped = await withSupabase(async (query) => ({ archived: await archiveDestinationOnly(neon, query) }));
  if (isFailure(wrapped)) {
    await writeState(sql, { phase: "invalid", detail: wrapped.error, validated: false, targetReachable: false });
    return { ok: false as const, error: wrapped.error };
  }
  const archived = wrapped.archived;
  if (!archived.ok) return archived;
  const current = await readState(sql);
  await writeState(sql, {
    phase: "archived_extras",
    detail: `Moved ${archived.removed} Supabase-only rows into the recovery table and removed them from the live wedding tables. ${archived.remaining} destination-only rows remain. The current database was not changed and traffic was not switched.`,
    source: asCounts(archived.source),
    target: asCounts(archived.target),
    targetReachable: true,
    validated: false,
    cutover: current?.cutover === "supabase" ? "supabase" : "neon",
  });
  return coreMigrationBoard(token);
}

export async function freezeCoreMigration(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Writes stay as they are until you confirm the pause. Nothing was switched." };
  const sql = await stateSql();
  const row = await readState(sql);
  if (row?.cutover !== "supabase") return { ok: false as const, error: "Writes were not paused. Wedding traffic is still on the current database." };
  await writeState(sql, {
    phase: "frozen",
    detail: "Wedding writes are paused. Reads stay on Supabase. The reverse sync has not run. Nothing was deleted.",
    cutover: "supabase",
    validated: Boolean(row.validated),
  });
  return coreMigrationBoard(token);
}

export async function resumeCoreWrites(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const row = await readState(sql);
  const decision = decideUnfreeze({ confirm, phase: row?.phase || "idle" });
  if (!decision.ok) return decision;
  await writeState(sql, {
    phase: row?.cutover === "supabase" ? "cutover" : "idle",
    detail: "Wedding writes resumed. Routing was not changed and neither database was deleted.",
    cutover: row?.cutover === "supabase" ? "supabase" : "neon",
    validated: false,
  });
  return coreMigrationBoard(token);
}

export async function reverseSyncCoreMigration(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Reverse sync stays off until you confirm it. Nothing was copied." };
  const sql = await stateSql();
  const row = await readState(sql);
  if (row?.phase !== "frozen") return { ok: false as const, error: "Reverse sync stays off until wedding writes are paused. Nothing was copied." };
  if (row.cutover !== "supabase") return { ok: false as const, error: "Reverse sync stays off because wedding traffic is not on Supabase. Nothing was copied." };
  const origin = await getSql();
  const neon: Query = (text, params) => origin.query(text, params);
  const result = await withSupabase(async (query) => {
    const copied = await copyCore(query, neon, "reverse");
    const fields = await fieldCompare(neon, query);
    return { copied, fields };
  });
  if (isFailure(result)) {
    await writeState(sql, { phase: "frozen", detail: result.error, cutover: "supabase", validated: false });
    return { ok: false as const, error: result.error };
  }
  if (!result.fields.ok) {
    await writeState(sql, {
      phase: "frozen",
      detail: `Reverse sync wrote ${result.copied} rows, then the field compare still found ${result.fields.total} differences. Routing stayed on Supabase. Nothing was deleted.`,
      cutover: "supabase",
      validated: false,
    });
    return { ok: false as const, error: "The reverse sync did not match every core field. Routing stayed on Supabase." };
  }
  await writeState(sql, {
    phase: "reverse_verified",
    detail: `Reverse sync matched every core field after copying ${result.copied} rows onto the current database. Writes stay paused. Routing is still Supabase until you roll back.`,
    cutover: "supabase",
    validated: true,
  });
  return coreMigrationBoard(token);
}

export async function rollbackCoreMigration(token: string, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await stateSql();
  const row = await readState(sql);
  const fresh = row?.phase === "reverse_verified" ? await validateTarget() : null;
  if (fresh && isFailure(fresh)) return fresh;
  const decision = decideRollback({
    confirm,
    cutover: row?.cutover || "neon",
    frozen: writesPaused(row?.phase || ""),
    reverseVerified: row?.phase === "reverse_verified",
    fieldCompareOk: Boolean(fresh && !isFailure(fresh) && fresh.fieldCompareOk),
  });
  if (!decision.ok) return decision;
  await writeState(sql, {
    phase: "rolled_back",
    detail: "Wedding data routing is back on the current database after a verified reverse sync. Neither database was deleted.",
    cutover: "neon",
    validated: false,
  });
  return coreMigrationBoard(token);
}
