import { randomUUID } from "node:crypto";
import { parse } from "pg-connection-string";
import type { Client } from "pg";
import coreMigration from "../../../../migrations/supabase/0017_wedding_core_additive.sql?raw";
import developerMigration from "../../../../migrations/supabase/0028_developer_control.sql?raw";
import accountMigration from "../../../../migrations/supabase/0029_circle_accounts_additive.sql?raw";
import { CORE_COLUMNS, CORE_PRIMARY_KEYS, CORE_TABLES } from "../core-migration";
import { trustedSupabaseSsl } from "../supabase-connect";
import { projectUrl, readControlConfig, validateDatabaseUrl } from "./config.server";
import { hyperdriveConnectionString, serverEnvironment } from "@/lib/env.server";
import type { Check, Diagnostic } from "./model";

const auditTable = "wc_developer_verification";
const columns = {
  ...CORE_COLUMNS,
  circle_accounts: ["id", "email", "phone", "name", "country", "password_hash", "updated_at"],
  [auditTable]: ["id", "checked_at"],
} as const;
const keys = { ...CORE_PRIMARY_KEYS, circle_accounts: ["id"], [auditTable]: ["id"] } as const;
const names = Object.keys(columns) as (keyof typeof columns)[];
type Table = (typeof names)[number];

const expectedType = (table: Table, column: string) => {
  if (table === auditTable && column === "id") return "uuid";
  if (column === "payload" || column === "ceremonies") return "jsonb";
  if (column.endsWith("_at")) return "timestamp with time zone";
  return "text";
};

type Inspection = { missing: Table[]; shape: string[]; security: string[]; permissions: string[] };
type CatalogRow = {
  name: Table;
  rls: boolean;
  policies: boolean;
  clientAccess: boolean;
  canRead: boolean;
  canWrite: boolean;
  primaryKey: string[];
  types: Record<string, string>;
  circleLink: boolean;
};

async function inspect(db: Client): Promise<Inspection> {
  const rows = (await db.query<CatalogRow>(`
    select c.relname as name, c.relrowsecurity as rls,
      exists(select 1 from pg_policy p where p.polrelid = c.oid) as policies,
      (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
        or has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) as "clientAccess",
      has_table_privilege(c.oid, 'SELECT') as "canRead",
      (has_table_privilege(c.oid, 'INSERT') and has_table_privilege(c.oid, 'DELETE')) as "canWrite",
      coalesce((select array_agg(a.attname order by k.n)::text[]
        from pg_constraint con cross join lateral unnest(con.conkey) with ordinality k(attnum,n)
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
        where con.conrelid = c.oid and con.contype = 'p'), '{}') as "primaryKey",
      (select jsonb_object_agg(a.attname, format_type(a.atttypid,a.atttypmod))
        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as types,
      exists(select 1 from pg_constraint con join pg_attribute a on a.attrelid = c.oid and a.attname = 'slug'
        join pg_attribute dest on dest.attrelid = con.confrelid and dest.attname = 'slug'
        where con.conrelid = c.oid and con.contype = 'f' and con.convalidated
          and con.confrelid = to_regclass('public.circles')
          and con.conkey = array[a.attnum] and con.confkey = array[dest.attnum]) as "circleLink"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relname = any($1::text[])
  `, [names])).rows;
  const result: Inspection = { missing: [], shape: [], security: [], permissions: [] };
  for (const name of names) {
    const row = rows.find((entry) => entry.name === name);
    if (!row) { result.missing.push(name); continue; }
    for (const column of columns[name]) {
      if (row.types?.[column] !== expectedType(name, column)) result.shape.push(`${name}.${column} is missing or has an incompatible type.`);
    }
    if (JSON.stringify(row.primaryKey) !== JSON.stringify(keys[name])) result.shape.push(`${name} has an incompatible primary key.`);
    if (CORE_TABLES.some((table) => table === name && table !== "circles") && !row.circleLink) result.shape.push(`${name} is missing its verified wedding foreign key.`);
    if (!row.rls || row.policies) result.security.push(`${name} does not match the server-only RLS baseline. Review existing policies before making changes.`);
    if (row.clientAccess) result.permissions.push(`${name} grants access to a browser role.`);
    if (!row.canRead || (name === auditTable && !row.canWrite)) result.permissions.push(`${name} lacks required server privileges.`);
  }
  return result;
}

function issues(result: Inspection) {
  return [...result.missing.map((table) => `${table} is missing.`), ...result.shape, ...result.security, ...result.permissions];
}

async function initialize(db: Client): Promise<Diagnostic> {
  await db.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(90211628)");
    const before = await inspect(db);
    const missingCore = CORE_TABLES.filter((table) => before.missing.includes(table));
    const conflicts = [...before.shape, ...before.security, ...before.permissions];
    if (missingCore.length && missingCore.length !== CORE_TABLES.length) {
      conflicts.push("Some wedding tables already exist. Review the partial schema before initializing it.");
    }
    if (missingCore.length === CORE_TABLES.length) {
      const recovery = await db.query<{ present: boolean }>("select to_regclass('public.wedding_core_recovery') is not null as present");
      if (recovery.rows[0]?.present) conflicts.push("An existing wedding recovery table needs review before applying the wedding migration.");
    }
    if (conflicts.length) {
      await db.query("rollback");
      return { ok: false, message: "Existing schema conflicts were found. No changes were made.", details: conflicts };
    }
    if (missingCore.length === CORE_TABLES.length) await db.query(coreMigration);
    if (before.missing.includes("circle_accounts")) await db.query(accountMigration);
    if (before.missing.includes(auditTable)) await db.query(developerMigration);
    const after = issues(await inspect(db));
    if (after.length) {
      await db.query("rollback");
      return { ok: false, message: "Schema verification failed and initialization was rolled back.", details: after };
    }
    await db.query("commit");
    return { ok: true, message: before.missing.length ? "Missing tables were initialized and verified. Existing rows were preserved." : "The required schema already exists. No schema changes were made." };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function readProbe(db: Client) {
  await db.query("select id from public.wc_developer_verification limit 1");
}

async function writeProbe(db: Client) {
  await db.query("begin");
  try {
    const id = randomUUID();
    await db.query("insert into public.wc_developer_verification(id) values ($1)", [id]);
    const result = await db.query("select id from public.wc_developer_verification where id = $1", [id]);
    if (result.rowCount !== 1) throw new Error("Write readback failed");
  } finally {
    await db.query("rollback");
  }
}

function failure(error: unknown, opened: boolean): Diagnostic {
  const code = (error as { code?: string } | null)?.code;
  const message = code === "28P01" || code === "28000" ? "Postgres rejected the database credentials."
    : code === "42501" ? "Postgres refused a required database permission."
    : code === "42P01" ? "The required diagnostic table is missing. Inspect and initialize the schema first."
    : code === "ENOTFOUND" || code === "EAI_AGAIN" ? "The database hostname could not be resolved."
    : opened ? "Postgres connected, but the database operation failed. No secret is included in this report."
    : "The Postgres connection could not be opened. Check the endpoint, network access, and TLS.";
  return { ok: false, message };
}

export async function runDatabaseCheck(check: Exclude<Check, "api">): Promise<Diagnostic> {
  const config = readControlConfig(await serverEnvironment());
  const hyperdrive = await hyperdriveConnectionString();
  const usingHyperdrive = Boolean(hyperdrive);
  const connectionString = hyperdrive || config.SUPABASE_DB_URL;
  if (!connectionString) return { ok: false, message: "Neither the HYPERDRIVE binding nor SUPABASE_DB_URL is configured." };
  if (!usingHyperdrive) {
    const project = projectUrl(config.SUPABASE_URL);
    if (!project) return { ok: false, message: "Configure SUPABASE_URL so the direct database check can verify the intended project." };
    const invalid = validateDatabaseUrl(connectionString, project);
    if (invalid) return { ok: false, message: invalid };
  }
  const parsed = usingHyperdrive ? null : parse(connectionString);
  let db: Client | undefined;
  let opened = false;
  try {
    const { Client } = await import("pg");
    db = new Client(usingHyperdrive
      ? { connectionString, connectionTimeoutMillis: 8_000, query_timeout: 10_000 }
      : {
          host: parsed!.host || undefined, port: Number(parsed!.port), database: parsed!.database || undefined,
          user: parsed!.user || undefined, password: parsed!.password || undefined, ssl: trustedSupabaseSsl(),
          connectionTimeoutMillis: 8_000, query_timeout: 10_000,
        });
    await db.connect();
    opened = true;
    await db.query("set statement_timeout = '8s'");
    const pass = (message: string, details?: string[]): Diagnostic => ({ ok: true, message, details, checkedAt: new Date().toISOString() });
    if (check === "connect") {
      await db.query("select 1");
      return pass("Postgres connected and answered a read-only query.");
    }
    if (check === "initialize") return await initialize(db);
    const result = await inspect(db);
    if (check === "inspect") return pass("Database catalog inspected without reading wedding records.", issues(result));
    const problems = check === "rls" ? [...result.missing, ...result.security, ...result.permissions]
      : check === "permissions" ? [...result.missing, ...result.permissions] : issues(result);
    if (problems.length) return { ok: false, message: "The schema or permissions need attention.", details: problems };
    if (check === "read" || check === "verify") await readProbe(db);
    if (check === "write" || check === "verify") await writeProbe(db);
    if (check === "verify") {
      if (!config.SUPABASE_PUBLISHABLE_KEY || !config.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, message: "Configure the publishable and service-role keys before activating persistent Developer storage." };
      const recorded = await db.query<{ checked_at: Date }>(
        "insert into public.wc_developer_verification(id) values ($1) returning checked_at", [randomUUID()],
      );
      return { ...pass("Postgres, schema, access controls, read, and write checks passed. Verification was recorded."), checkedAt: recorded.rows[0].checked_at.toISOString() };
    }
    const messages = {
      schema: "Required tables, columns, primary keys and wedding relationships are compatible.",
      read: "The diagnostic table could be read without reading wedding data.",
      write: "A diagnostic row was written, read back, and rolled back.",
      rls: "RLS is enabled and browser roles have no access to the inspected tables.",
      permissions: "The database role has the required privileges and browser roles have no grants.",
    };
    return pass(messages[check]);
  } catch (error) {
    return failure(error, opened);
  } finally {
    await db?.end().catch(() => undefined);
  }
}
