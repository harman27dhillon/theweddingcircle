#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Applies the application schema only to Supabase Postgres.
 * Pending files in ../migrations are applied once each. Nothing is dropped.
 *
 * No database URL (local / preview builds) -> skip; PGLite applies the same
 * files at startup. When SUPABASE_DB_URL is present only at runtime, the server
 * applies any pending files on first connection.
 */
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import tls from "node:tls";
import pg from "pg";
import { parse } from "pg-connection-string";
import { pendingMigrations } from "./migration-plan.mjs";

const supabaseUrl = process.env.SUPABASE_DB_URL?.trim() || "";
const target = supabaseUrl.startsWith("postgres")
  ? { url: supabaseUrl, name: "SUPABASE_DB_URL" }
  : null;

if (!target) {
  console.log(
    "[migrate] SUPABASE_DB_URL is not set — skipping. Local preview uses its disposable PGLite database. Set SUPABASE_DB_URL for the persistent database.",
  );
  process.exit(0);
}

function supabaseCa() {
  try {
    const text = readFileSync(fileURLToPath(new URL("../src/lib/developer/supabase-root-ca.ts", import.meta.url)), "utf8");
    const match = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    return match ? match[0] : "";
  } catch {
    return "";
  }
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const parsed = parse(target.url);
  const pool = new pg.Pool({
    host: parsed.host || undefined,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: parsed.user || undefined,
    password: parsed.password || undefined,
    database: parsed.database || undefined,
    max: 1,
    ssl: { rejectUnauthorized: true, ca: [...tls.rootCertificates, supabaseCa()].filter(Boolean) },
  });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied to ${target.name}.` : `[migrate] ${target.name} is up to date.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
