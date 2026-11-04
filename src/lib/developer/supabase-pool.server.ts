import { createHash } from "node:crypto";
import { parse } from "pg-connection-string";
import type { Sql } from "@/lib/db";
import { redactCloud } from "@/lib/developer/cloud";
import { classifyDatabaseError, safeSupabaseUri, trustedSupabaseSsl, type SafeDbUri } from "@/lib/developer/supabase-connect";
import { env } from "@/lib/env.server";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

type Cache = { key: string; sql: Promise<Sql> };
const globalRef = globalThis as typeof globalThis & { __wcSupabaseSql__?: Cache };

function failureOf(error: unknown, uri: SafeDbUri) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  const classified = classifyDatabaseError({ code, message }, uri);
  return redactCloud(classified.detail, [env("SUPABASE_DB_URL") || ""].filter((item) => item.length > 6));
}

async function openPool(raw: string, max: number) {
  const { Pool, types } = await import("pg");
  const parsed = parse(raw);
  types.setTypeParser(20, Number);
  types.setTypeParser(1082, (value) => value);
  types.setTypeParser(1186, (value) => value);
  // Fields are passed individually. pg copies a connectionString over an
  // explicit ssl object, which dropped the trusted CA and failed verification.
  return new Pool({
    host: parsed.host || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.user || undefined,
    password: parsed.password || undefined,
    database: parsed.database || undefined,
    ...(parsed.options ? { options: parsed.options } : {}),
    max,
    connectionTimeoutMillis: 8_000,
    query_timeout: 8_000,
    idleTimeoutMillis: 10_000,
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
export async function runSupabaseSchema(files: { name: string; sql: string }[]) {
  const raw = env("SUPABASE_DB_URL") || "";
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") throw new Error(uri.detail);
  const pool = await openPool(raw, 1);
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
  const raw = env("SUPABASE_DB_URL") || "";
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ok: false, error: uri.detail };
  const pool = await openPool(raw, 1);
  try {
    await pool.query("select 1 as ok");
    return await fn(async (text, params = []) => {
      const result = await pool.query(text, params);
      return result.rows as Record<string, unknown>[];
    });
  } catch (error) {
    return { ok: false, error: failureOf(error, uri) };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Long-lived wedding pool. Used only after an explicit cutover. */
export async function openSupabaseSql(): Promise<{ ok: true; sql: Sql } | { ok: false; error: string }> {
  const raw = env("SUPABASE_DB_URL") || "";
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ok: false, error: uri.detail };
  const key = createHash("sha256").update(raw).digest("hex").slice(0, 20);
  if (!globalRef.__wcSupabaseSql__ || globalRef.__wcSupabaseSql__.key !== key) {
    const opening = (async () => {
      const pool = await openPool(raw, 2);
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
    return { ok: false, error: failureOf(error, uri) };
  }
}

/** One read-only select. Does not copy rows or change routing. */
export async function probeSupabaseConnection(): Promise<SafeDbUri & { tested: boolean; code: string }> {
  const raw = env("SUPABASE_DB_URL") || "";
  const uri = safeSupabaseUri(raw);
  if (uri.status !== "ready") return { ...uri, tested: false, code: "" };
  const pool = await openPool(raw, 1);
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
