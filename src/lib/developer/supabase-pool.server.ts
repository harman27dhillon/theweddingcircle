import { createHash } from "node:crypto";
import { parse } from "pg-connection-string";
import type { Sql } from "@/lib/db";
import { redactCloud } from "@/lib/developer/cloud";
import { classifyDatabaseError, safeSupabaseUri, trustedSupabaseSsl, type SafeDbUri } from "@/lib/developer/supabase-connect";
import { env, hyperdriveConnectionString } from "@/lib/env.server";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

type Cache = { key: string; sql: Promise<Sql> };
const globalRef = globalThis as typeof globalThis & { __wcSupabaseSql__?: Cache };

function failureOf(error: unknown, uri: SafeDbUri, raw = "") {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  const classified = classifyDatabaseError({ code, message }, uri);
  return redactCloud(classified.detail, [raw, env("SUPABASE_DB_URL") || ""].filter((item) => item.length > 6));
}

async function openPool(raw: string, max: number, mode: "direct" | "hyperdrive" = "direct") {
  const { Pool, types } = await import("pg");
  const parsed = parse(raw);
  types.setTypeParser(20, Number);
  types.setTypeParser(1082, (value) => value);
  types.setTypeParser(1186, (value) => value);
  const limits = {
    max,
    connectionTimeoutMillis: 8_000,
    query_timeout: 8_000,
    idleTimeoutMillis: 10_000,
  };
  if (mode === "hyperdrive") {
    // Hyperdrive supplies its own runtime connection string and TLS handling.
    // Do not apply Supabase's origin certificate to the Hyperdrive endpoint.
    return new Pool({ connectionString: raw, ...limits });
  }
  // Direct Supabase uses its published root CA; pass fields separately because
  // pg's connectionString parsing can override an explicit ssl object.
  return new Pool({
    host: parsed.host || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.user || undefined,
    password: parsed.password || undefined,
    database: parsed.database || undefined,
    ...(parsed.options ? { options: parsed.options } : {}),
    ...limits,
    ssl: trustedSupabaseSsl(),
  });
}

function toSql(run: <T>(text: string, params: unknown[]) => Promise<T[]>): Sql {
  const sql = (async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    return run<T>(text, values);
  }) as Sql;
  sql.query = (text, params = []) => run(text, params);
  return sql;
}

/** Apply versioned app migrations once. Does not drop, truncate, or rewrite existing rows. */
export async function runSupabaseSchema(files: { name: string; sql: string }[], connectionString = env("SUPABASE_DB_URL") || "", mode: "direct" | "hyperdrive" = "direct") {
  const raw = connectionString;
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") throw new Error(uri.detail);
  const pool = await openPool(raw, 1, mode);
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const applied = new Set((await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((row) => row.name));
    for (const file of files) {
      if (!file.name || applied.has(file.name)) continue;
      try {
        await client.query("BEGIN");
        await client.query(file.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file.name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

/** One attempt. The URI is passed through unchanged. */
export async function withSupabase<T>(fn: (query: Query) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const hyperdrive = await hyperdriveConnectionString();
  const raw = hyperdrive || env("SUPABASE_DB_URL") || "";
  const mode = hyperdrive ? "hyperdrive" as const : "direct" as const;
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ok: false, error: uri.detail };
  const pool = await openPool(raw, 1, mode);
  try {
    await pool.query("select 1 as ok");
    return await fn(async (text, params = []) => {
      const result = await pool.query(text, params);
      return result.rows as Record<string, unknown>[];
    });
  } catch (error) {
    return { ok: false, error: failureOf(error, uri, raw) };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Long-lived wedding pool. Used only after an explicit cutover. */
export async function openSupabaseSql(connectionString?: string, requestedMode?: "direct" | "hyperdrive"): Promise<{ ok: true; sql: Sql } | { ok: false; error: string }> {
  const hyperdrive = connectionString ? undefined : await hyperdriveConnectionString();
  const raw = connectionString || hyperdrive || env("SUPABASE_DB_URL") || "";
  const mode = requestedMode || (hyperdrive ? "hyperdrive" : "direct");
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ok: false, error: uri.detail };
  const key = createHash("sha256").update(raw).digest("hex").slice(0, 20);
  if (!globalRef.__wcSupabaseSql__ || globalRef.__wcSupabaseSql__.key !== key) {
    const opening = (async () => {
      const pool = await openPool(raw, 2, mode);
      return toSql(async <T>(text: string, params: unknown[]) => {
        const result = await pool.query(text, params);
        return result.rows as T[];
      });
    })().catch((error) => {
      if (globalRef.__wcSupabaseSql__?.key === key) globalRef.__wcSupabaseSql__ = undefined;
      throw error;
    });
    globalRef.__wcSupabaseSql__ = { key, sql: opening };
  }
  try {
    const sql = await globalRef.__wcSupabaseSql__.sql;
    await sql`select 1 as ok`;
    return { ok: true, sql };
  } catch (error) {
    if (globalRef.__wcSupabaseSql__?.key === key) globalRef.__wcSupabaseSql__ = undefined;
    return { ok: false, error: failureOf(error, uri, raw) };
  }
}

/** One read-only select. Does not copy rows or change routing. */
export async function probeSupabaseConnection(): Promise<SafeDbUri & { tested: boolean; code: string }> {
  const hyperdrive = await hyperdriveConnectionString();
  const raw = hyperdrive || env("SUPABASE_DB_URL") || "";
  const mode = hyperdrive ? "hyperdrive" as const : "direct" as const;
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ...uri, tested: false, code: "" };
  const pool = await openPool(raw, 1, mode);
  try {
    const result = await pool.query("select 1 as ok");
    if (Number(result.rows[0]?.ok) !== 1) {
      return { ...uri, status: "network_tls", tested: true, code: "", detail: "The database answered, but the read-only check was not the expected result. Nothing was copied and traffic did not move." };
    }
    return {
      ...uri,
      status: "connected",
      tested: true,
      code: "",
      detail: `Read-only connection succeeded at ${uri.host}:${uri.port}, database ${uri.database}. No wedding rows were read or copied. Traffic did not move.`,
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
    const message = error instanceof Error ? error.message : "";
    const classified = classifyDatabaseError({ code, message }, uri);
    return {
      ...uri,
      status: classified.status,
      tested: true,
      code: classified.code,
      detail: redactCloud(classified.detail, [raw].filter((item) => item.length > 6)),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
