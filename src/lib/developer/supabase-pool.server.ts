import { createHash } from "node:crypto";
import { parse } from "pg-connection-string";
import type { Sql } from "@/lib/db";
import { redactCloud } from "@/lib/developer/cloud";
import { classifyDatabaseError, safeSupabaseUri, stagingDatabaseUrl, trustedSupabaseSsl, type SafeDbUri } from "@/lib/developer/supabase-connect";
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

function directConnectionOptions(raw: string) {
  const parsed = parse(raw);
  return {
    host: parsed.host || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.user || undefined,
    password: parsed.password || undefined,
    database: parsed.database || undefined,
    ...(parsed.options ? { options: parsed.options } : {}),
    ssl: trustedSupabaseSsl(),
  };
}

async function postgresDriver() {
  const pg = await import("pg");
  pg.types.setTypeParser(20, Number);
  pg.types.setTypeParser(1082, (value) => value);
  pg.types.setTypeParser(1186, (value) => value);
  return pg;
}

const queryLimits = { connectionTimeoutMillis: 8_000, query_timeout: 8_000 };

async function openPool(raw: string, max: number, mode: "direct" | "hyperdrive" = "direct") {
  const { Pool } = await postgresDriver();
  // Hyperdrive supplies its own TLS handling. Direct Supabase verifies its CA.
  const connection = mode === "hyperdrive" ? { connectionString: raw } : directConnectionOptions(raw);
  return new Pool({ ...connection, ...queryLimits, max, idleTimeoutMillis: 10_000 });
}

function databaseUri(raw: string, mode: "direct" | "hyperdrive") {
  const uri = safeSupabaseUri(raw);
  if (mode === "hyperdrive" || env("APP_ENV") !== "staging") return uri;
  try {
    stagingDatabaseUrl({ SUPABASE_DB_URL: raw });
    return uri;
  } catch (error) {
    return { ...uri, status: "invalid_uri" as const, detail: (error as Error).message };
  }
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
  const uri = databaseUri(raw, mode);
  if (uri.status !== "ready") throw new Error(uri.detail);
  const pool = await openPool(raw, 1, mode);
  try {
    const client = await pool.connect();
    try {
      await client.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
      const applied = new Set((await client.query<{ name: string }>("SELECT name FROM _migrations")).rows.map((row) => row.name));
      for (const file of files) {
        if (!file.name || applied.has(file.name)) continue;
        try {
          await client.query("BEGIN");
          const claim = await client.query(
            "INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
            [file.name],
          );
          if (claim.rowCount === 1) await client.query(file.sql);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** One attempt. The URI is passed through unchanged. */
export async function withSupabase<T>(fn: (query: Query) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const hyperdrive = await hyperdriveConnectionString();
  const raw = hyperdrive || env("SUPABASE_DB_URL") || "";
  const mode = hyperdrive ? "hyperdrive" as const : "direct" as const;
  const uri = databaseUri(raw, mode);
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
  const uri = databaseUri(raw, mode);
  if (uri.status !== "ready") return { ok: false, error: uri.detail };
  if (mode === "hyperdrive" || env("APP_ENV") === "staging") {
    // Cache only the query function. Worker sockets belong to the request
    // that created them. Staging uses the Supabase session pooler directly.
    const { Client } = await postgresDriver();
    const connection = mode === "hyperdrive" ? { connectionString: raw } : directConnectionOptions(raw);
    const sql = toSql(async <T>(text: string, params: unknown[]) => {
      const client = new Client({ ...connection, ...queryLimits });
      try {
        await client.connect();
        return (await client.query(text, params)).rows as T[];
      } finally {
        await client.end().catch(() => undefined);
      }
    });
    return { ok: true, sql };
  }
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
  const uri = databaseUri(raw, mode);
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
