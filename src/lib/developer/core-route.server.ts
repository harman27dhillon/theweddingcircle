import { dbSource, getSql, type Sql } from "@/lib/db";
import { chooseWeddingRoute, isMutationStatement } from "@/lib/developer/core-migration";
import { openSupabaseSql } from "@/lib/developer/supabase-pool.server";
import { env, isWorkspacePreview } from "@/lib/env.server";

type RouteState = { wanted: "supabase"; used: "supabase" | "pglite"; reason: string };

const globalRef = globalThis as typeof globalThis & {
  __wcCoreRoute__?: RouteState;
};

export function verifiedCoreRoute(): RouteState | null {
  return globalRef.__wcCoreRoute__ ?? null;
}

export function invalidateCutoverCache() {
  globalRef.__wcCoreRoute__ = undefined;
}

export async function readCutover(): Promise<"supabase"> {
  return "supabase";
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

/** All persistent wedding data uses Supabase. PGLite is allowed only in local preview. */
export async function weddingDataSql(): Promise<Sql> {
  const sql = await getSql();
  if (dbSource === "pglite" && (!isWorkspacePreview() || Boolean(env("VERCEL")))) {
    throw new Error("Supabase is not configured for this deployed environment. No fallback database will be used.");
  }
  const reason = dbSource === "supabase"
    ? "Wedding records use Supabase Postgres."
    : "Local preview is using disposable PGLite.";
  globalRef.__wcCoreRoute__ = { wanted: "supabase", used: dbSource, reason };
  return sql;
}
