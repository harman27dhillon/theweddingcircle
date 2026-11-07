import { dbSource, getSql, type Sql } from "@/lib/db";
import { chooseWeddingRoute, isMutationStatement } from "@/lib/developer/core-migration";
import { openSupabaseSql } from "@/lib/developer/supabase-pool.server";
import { env, isWorkspacePreview } from "@/lib/env.server";

type RouteState = { wanted: "neon" | "supabase"; used: "neon" | "supabase"; reason: string };
type Flags = { at: number; cutover: "neon" | "supabase"; phase: string };

const globalRef = globalThis as typeof globalThis & {
  __wcCoreCutover__?: { at: number; value: "neon" | "supabase" };
  __wcCoreFlags__?: Flags;
  __wcCoreRoute__?: RouteState;
};

export function verifiedCoreRoute(): RouteState | null {
  return globalRef.__wcCoreRoute__ ?? null;
}

export function invalidateCutoverCache() {
  globalRef.__wcCoreCutover__ = undefined;
  globalRef.__wcCoreFlags__ = undefined;
}

async function ensureState(sql: Sql) {
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
}

async function readFlags(): Promise<Flags> {
  const cached = globalRef.__wcCoreFlags__;
  if (cached && Date.now() - cached.at < 4000) return cached;
  try {
    const sql = await getSql();
    await ensureState(sql);
    const rows = await sql<{ cutover: string; phase: string }>`select cutover, phase from developer_core_migration where id = 'current' limit 1`;
    const flags: Flags = {
      at: Date.now(),
      cutover: rows[0]?.cutover === "supabase" ? "supabase" : "neon",
      phase: rows[0]?.phase || "idle",
    };
    globalRef.__wcCoreFlags__ = flags;
    globalRef.__wcCoreCutover__ = { at: flags.at, value: flags.cutover };
    return flags;
  } catch {
    return { at: 0, cutover: "neon", phase: "idle" };
  }
}

export async function readCutover(): Promise<"neon" | "supabase"> {
  const flags = await readFlags();
  return flags.cutover;
}

const WRITE_PAUSED = "Wedding writes are paused for a migration check. Nothing was saved. Reads still work.";

export function guardPausedWrites(sql: Sql): Sql {
  const wrapped = (async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    if (isMutationStatement(text)) throw new Error(WRITE_PAUSED);
    return sql<T>(strings, ...values);
  }) as Sql;
  wrapped.query = async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
    if (isMutationStatement(text)) throw new Error(WRITE_PAUSED);
    return sql.query<T>(text, params);
  };
  return wrapped;
}

/** Wedding rows. When SUPABASE_DB_URL is set, this is the only database. A failure is not written to Neon. */
export async function weddingDataSql(): Promise<Sql> {
  if (env("APP_ENV") === "staging") {
    const sql = await getSql();
    globalRef.__wcCoreRoute__ = { wanted: "supabase", used: "supabase", reason: "Staging uses its dedicated Supabase database." };
    return sql;
  }
  const production = !isWorkspacePreview() || Boolean(env("VERCEL"));
  const supabaseConfigured = (env("SUPABASE_DB_URL") || "").startsWith("postgres");
  const neonConfigured = dbSource === "neon";
  if (supabaseConfigured) {
    const opened = await openSupabaseSql();
    const choice = chooseWeddingRoute({
      production,
      supabaseConfigured: true,
      neonConfigured,
      cutover: "supabase",
      phase: "cutover",
      supabaseOpen: opened.ok,
      activation: "not_needed",
    });
    const reason = opened.ok ? choice.reason : opened.error;
    if (!opened.ok || choice.use !== "supabase") {
      globalRef.__wcCoreRoute__ = { wanted: "supabase", used: "supabase", reason };
      throw new Error(`${reason} Nothing was read from or written to another database.`);
    }
    globalRef.__wcCoreRoute__ = { wanted: "supabase", used: "supabase", reason };
    return opened.sql;
  }
  const choice = chooseWeddingRoute({
    production,
    supabaseConfigured: false,
    neonConfigured,
    cutover: "neon",
    phase: "idle",
    supabaseOpen: false,
    activation: "not_needed",
  });
  if (choice.use === "refuse") {
    globalRef.__wcCoreRoute__ = { wanted: "supabase", used: "neon", reason: choice.reason };
    throw new Error(choice.reason);
  }
  globalRef.__wcCoreRoute__ = { wanted: "neon", used: "neon", reason: choice.reason };
  return getSql();
}
