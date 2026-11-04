import { duplicateMessageIds } from "../wedding/offline.ts";
import {
  CORE_COLUMNS,
  CORE_PRIMARY_KEYS,
  CORE_TABLES,
  SUPABASE_CORE_CONSTRAINTS,
  SUPABASE_CORE_SQL,
  compareCoreRows,
  compareCounts,
  coreRowKey,
  decideCoreCutover,
  describeFieldDiffs,
  reviewGrants,
  reviewRls,
  reviewServerAccess,
  schemaLooksSafe,
  upsertConflict,
  type CoreTable,
} from "./core-migration.ts";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const JSON_COLUMNS = new Set(["payload", "ceremonies"]);
const CHILD_FIRST: CoreTable[] = ["circle_members", "circle_auth", "ceremony_invites", "couple_access", "circles"];

function ident(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : "";
}

function missingRelation(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "42P01" || /does not exist/i.test(message);
}

function ignorable(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "42710" || code === "42704" || /already exists/i.test(message);
}

function statements() {
  return SUPABASE_CORE_SQL.split(";").map((item) => item.trim()).filter(Boolean);
}

async function applyStatement(query: Query, statement: string) {
  try {
    await query(statement);
  } catch (error) {
    if (ignorable(error)) return;
    throw error;
  }
}

function jsonValue(value: unknown) {
  if (value == null) return "{}";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function readColumns(query: Query) {
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

async function alignColumns(query: Query, columns: Awaited<ReturnType<typeof readColumns>>) {
  for (const column of columns) {
    if (!ident(column.table) || !ident(column.name)) continue;
    if (/password|session|secret/i.test(column.name)) {
      return { ok: false as const, error: `Source column ${column.table}.${column.name} was not copied because it looks like a credential. Traffic did not move.` };
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
      return { ok: false as const, error: `public.${table} is missing on the destination. Traffic did not move.` };
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
  return { ok: true as const, copied };
}

async function keysOf(query: Query, table: CoreTable) {
  const keys = CORE_PRIMARY_KEYS[table];
  const rows = await query(`select ${keys.join(", ")} from public.${table}`);
  const encoded = rows.map((row) => keys.map((key) => String(row[key] ?? "")).join("\u0000"));
  return { keys, rows, encoded };
}

async function dropMissing(source: Query, target: Query) {
  let removed = 0;
  for (const table of CHILD_FIRST) {
    const left = await keysOf(source, table);
    const right = await keysOf(target, table);
    const have = new Set(left.encoded);
    for (let index = 0; index < right.rows.length; index += 1) {
      if (have.has(right.encoded[index] || "")) continue;
      const row = right.rows[index] || {};
      const where = left.keys.map((key, keyIndex) => `${key} = $${keyIndex + 1}`).join(" and ");
      await target(`delete from public.${table} where ${where}`, left.keys.map((key) => row[key]));
      removed += 1;
    }
  }
  return removed;
}

async function countTables(query: Query) {
  const counts: Record<string, number> = {};
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

async function readTable(query: Query, table: CoreTable) {
  try {
    return await query(`select ${CORE_COLUMNS[table].join(", ")} from public.${table}`);
  } catch (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
}

async function applyConstraints(query: Query) {
  for (const statement of SUPABASE_CORE_CONSTRAINTS) {
    try {
      await query(statement);
    } catch (error) {
      if (ignorable(error)) continue;
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
      if (code === "23503") return { ok: false as const, error: "A wedding link could not be added because some rows point at a missing wedding. Nothing was switched." };
      const message = error instanceof Error ? error.message : "The wedding link could not be added.";
      return { ok: false as const, error: message.slice(0, 240) };
    }
  }
  return { ok: true as const };
}

async function readRls(query: Query) {
  const tables = await query(
    `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('circles', 'circle_members', 'circle_auth', 'ceremony_invites', 'couple_access')`,
  );
  const policies = await query(
    `select tablename as table, roles::text as roles from pg_policies where schemaname = 'public' and tablename in ('circles', 'circle_members', 'circle_auth', 'ceremony_invites', 'couple_access')`,
  );
  return reviewRls({
    tables: tables.map((row) => ({ name: String(row.name || ""), rls: row.rls === true || row.rls === "t" || row.rls === "true" })),
    policies: policies.map((row) => ({ table: String(row.table || ""), roles: String(row.roles || "") })),
  });
}

async function readGrants(query: Query) {
  const rows = await query(
    `select table_name as table, grantee, privilege_type as privilege from information_schema.role_table_grants where table_schema = 'public' and lower(grantee) in ('anon', 'authenticated', 'public') and table_name in ('circles', 'circle_members', 'circle_auth', 'ceremony_invites', 'couple_access')`,
  );
  return reviewGrants(rows.map((row) => ({ table: String(row.table || ""), grantee: String(row.grantee || ""), privilege: String(row.privilege || "") })));
}

export type Audit = {
  ok: boolean;
  error: string;
  source: Record<string, number>;
  target: Record<string, number>;
  fieldDiffs: number;
  extraRows: number;
  valueConflicts: number;
  missingRows: number;
  publicClosed: boolean;
  serverAccessOk: boolean;
  orphanInvites: number;
  duplicateIds: number;
  diffs: { table: string; key: string; column: string; kind: string }[];
};

function truthy(value: unknown) {
  return value === true || value === "t" || value === "true";
}

async function readServerAccess(query: Query) {
  const roleRows = await query(`select current_user as role`);
  const role = String(roleRows[0]?.role || "");
  const tables = [];
  for (const table of CORE_TABLES) {
    const rows = await query(
      `select has_table_privilege(current_user, $1, 'SELECT') as can_select, has_table_privilege(current_user, $1, 'INSERT') as can_insert, has_table_privilege(current_user, $1, 'UPDATE') as can_update, has_table_privilege(current_user, $1, 'DELETE') as can_delete`,
      [`public.${table}`],
    );
    const row = rows[0] || {};
    tables.push({
      table,
      select: truthy(row.can_select),
      insert: truthy(row.can_insert),
      update: truthy(row.can_update),
      delete: truthy(row.can_delete),
    });
  }
  return reviewServerAccess({ role, tables });
}

async function collectDiffs(source: Query, target: Query) {
  const diffs = [];
  for (const table of CORE_TABLES) {
    const left = await readTable(source, table);
    const right = await readTable(target, table);
    if (!left || !right) {
      diffs.push({ table, key: "", column: "*", kind: "missing_on_target" as const });
      continue;
    }
    diffs.push(...compareCoreRows(table, left, right).diffs);
  }
  return diffs;
}

function auditError(diffs: { kind: string }[], rlsOk: boolean, grantsOk: boolean, serverOk: boolean, orphanInvites: number, duplicateIds: number) {
  const extraRows = diffs.filter((diff) => diff.kind === "extra_on_target").length;
  const valueConflicts = diffs.filter((diff) => diff.kind === "value").length;
  const missingRows = diffs.filter((diff) => diff.kind === "missing_on_target").length;
  if (extraRows || valueConflicts || missingRows || !rlsOk || !grantsOk || !serverOk || orphanInvites !== 0 || duplicateIds !== 0) {
    const access = !rlsOk || !grantsOk
      ? "Public access is not closed."
      : serverOk
        ? "Public access is closed and the server connection can read and write the wedding tables."
        : "Public access is closed, but the server connection cannot read and write the wedding tables.";
    return {
      extraRows,
      valueConflicts,
      missingRows,
      error: `Validation did not pass. Destination-only rows: ${extraRows}. Field conflicts: ${valueConflicts}. Missing on Supabase: ${missingRows}. ${access} Those destination-only rows were not deleted. Wedding traffic stays on the current database.`,
    };
  }
  return { extraRows, valueConflicts, missingRows, error: "" };
}

/** Read-only comparison. Does not copy or delete. */
export async function auditPair(source: Query, target: Query): Promise<Audit> {
  const sourceCounts = await countTables(source);
  const targetCounts = await countTables(target);
  const diffs = await collectDiffs(source, target);
  const rls = await readRls(target);
  const grants = await readGrants(target);
  const server = await readServerAccess(target);
  let orphanInvites = 0;
  try {
    const orphans = await target(`select count(*)::int as n from public.ceremony_invites i left join public.circles c on c.slug = i.slug where c.slug is null`);
    orphanInvites = Number(orphans[0]?.n ?? 0);
  } catch (error) {
    if (!missingRelation(error)) throw error;
    orphanInvites = -1;
  }
  let payloads: unknown[] = [];
  try {
    const rows = await target(`select payload from public.circles`);
    payloads = rows.map((row) => row.payload);
  } catch (error) {
    if (!missingRelation(error)) throw error;
  }
  const duplicateIds = duplicateMessageIds(payloads).length;
  const summary = auditError(diffs, rls.ok, grants.ok, server.ok, orphanInvites, duplicateIds);
  const counts = compareCounts(sourceCounts, targetCounts, true);
  const decision = decideCoreCutover({
    confirm: true,
    validated: counts.ok && summary.error === "" && rls.ok && grants.ok && server.ok,
    countsMatch: counts.ok,
    fieldCompareOk: diffs.length === 0,
    dbUrlConfigured: true,
    duplicateIds,
    orphanInvites,
  });
  return {
    ok: decision.ok && summary.error === "",
    error: summary.error || (decision.ok ? "" : decision.error),
    source: sourceCounts,
    target: targetCounts,
    fieldDiffs: diffs.length,
    extraRows: summary.extraRows,
    valueConflicts: summary.valueConflicts,
    missingRows: summary.missingRows,
    publicClosed: rls.ok && grants.ok,
    serverAccessOk: server.ok,
    orphanInvites,
    duplicateIds,
    diffs: describeFieldDiffs(diffs),
  };
}

function snapshotId(table: string, key: string, row: Record<string, unknown>) {
  let hash = 2166136261;
  const body = `${table}|${key}|${JSON.stringify(row)}`;
  for (let i = 0; i < body.length; i += 1) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
  return `r${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function rememberConflicts(source: Query, target: Query) {
  let kept = 0;
  for (const table of CORE_TABLES) {
    const left = await readTable(source, table);
    const right = await readTable(target, table);
    if (!left || !right) continue;
    const diffs = compareCoreRows(table, left, right).diffs;
    const interesting = new Map(diffs.filter((diff) => diff.kind !== "missing_on_target").map((diff) => [diff.key, diff.kind]));
    for (const row of right) {
      const key = coreRowKey(table, row);
      const kind = interesting.get(key);
      if (!kind) continue;
      const reason = kind === "extra_on_target" ? "destination_only" : "field_conflict";
      await target(
        `insert into public.wedding_core_recovery (id, table_name, row_key, reason, row_data) values ($1, $2, $3, $4, $5::jsonb) on conflict (id) do nothing`,
        [snapshotId(table, key, row), table, key.replaceAll("\u0000", "|").slice(0, 180), reason, JSON.stringify(row)],
      );
      kept += 1;
    }
  }
  return kept;
}

export type ReconcileResult =
  | { ok: true; copied: number; removed: number; preserved: number; source: Record<string, number>; target: Record<string, number> }
  | { ok: false; error: string; source?: Record<string, number>; target?: Record<string, number>; preserved?: number };

/**
 * Additive schema and upsert from the source. Destination-only rows are copied
 * into wedding_core_recovery and left in place. Nothing is deleted here.
 */
export async function reconcilePair(source: Query, target: Query): Promise<ReconcileResult> {
  if (!schemaLooksSafe(SUPABASE_CORE_SQL)) return { ok: false, error: "The prepared schema was refused. Nothing was switched." };
  for (const statement of statements()) await applyStatement(target, statement);
  const aligned = await alignColumns(target, await readColumns(source));
  if (!aligned.ok) return aligned;
  const sourceCircles = await keysOf(source, "circles");
  const targetCircles = await keysOf(target, "circles");
  if (sourceCircles.rows.length === 0 && targetCircles.rows.length > 0) {
    return { ok: false, error: "The current database has no wedding records while Supabase does. No rows were deleted and traffic did not move." };
  }
  const preserved = await rememberConflicts(source, target);
  let copied = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const wrote = await copyCore(source, target, "forward");
    if (!wrote.ok) return wrote;
    copied += wrote.copied;
  }
  const linked = await applyConstraints(target);
  if (!linked.ok) return linked;
  const audit = await auditPair(source, target);
  if (!audit.ok) return { ok: false, error: audit.error, source: audit.source, target: audit.target, preserved };
  return { ok: true, copied, removed: 0, preserved, source: audit.source, target: audit.target };
}

/** Copy destination-only rows into recovery, then remove only those rows from Supabase. */
export async function archiveDestinationOnly(source: Query, target: Query) {
  if (!schemaLooksSafe(SUPABASE_CORE_SQL)) return { ok: false as const, error: "The recovery schema was refused. Nothing was removed." };
  for (const statement of statements()) await applyStatement(target, statement);
  const preserved = await rememberConflicts(source, target);
  const removed = await dropMissing(source, target);
  const audit = await auditPair(source, target);
  return { ok: true as const, removed, preserved, source: audit.source, target: audit.target, remaining: audit.extraRows };
}

/** Copy Supabase wedding rows back onto the source and report whether every field matches. */
export async function restoreOntoSource(target: Query, source: Query) {
  const wrote = await copyCore(target, source, "reverse");
  if (!wrote.ok) return wrote;
  const diffs = await collectDiffs(source, target);
  return { ok: diffs.length === 0, copied: wrote.copied, diffs: diffs.length };
}
