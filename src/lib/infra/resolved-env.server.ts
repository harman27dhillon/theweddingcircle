import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { env, isWorkspacePreview, serverEnvironment } from "@/lib/env.server";
import { effectiveInfraEnv } from "@/lib/infra/config";
import { openJson } from "@/lib/wedding/affiliate.crypto";

export type ResolvedInfraEnv = {
  env: Record<string, string | undefined>;
  saved: Record<string, string>;
  unreadable: boolean;
  locked: boolean;
};

/** Same key order as the Infrastructure vault writer. Preview without a key uses one process key. */
export function infraVaultKey() {
  const stable = env("INFRA_VAULT_KEY") || env("AFFILIATE_VAULT_KEY") || env("BETTER_AUTH_SECRET") || "";
  if (stable) return stable;
  if (!isWorkspacePreview()) return "";
  const holder = globalThis as typeof globalThis & { __infraVaultKey?: string };
  if (!holder.__infraVaultKey) holder.__infraVaultKey = randomBytes(32).toString("hex");
  return holder.__infraVaultKey;
}

/**
 * Process environment plus non-blank encrypted vault overrides.
 * A database or vault failure leaves process.env in place and does not invent saved fields.
 */
export async function resolvedInfraEnv(readOnly = false): Promise<ResolvedInfraEnv> {
  const base = await serverEnvironment();
  try {
    const sql = await getSql();
    if (!readOnly) await sql`
      create table if not exists infra_config (
        id text primary key,
        cipher text not null,
        nonce text not null,
        updated_by text not null default '',
        updated_at timestamptz not null default now()
      )
    `;
    const key = infraVaultKey();
    if (!key) return { env: base, saved: {}, unreadable: false, locked: true };
    const rows = await sql<{ cipher: string; nonce: string }>`select cipher, nonce from infra_config where id = ${"active"} limit 1`;
    const row = rows[0];
    if (!row?.cipher || !row.nonce) return { env: base, saved: {}, unreadable: false, locked: false };
    try {
      const saved = openJson({ cipher: row.cipher, nonce: row.nonce }, key);
      return { env: effectiveInfraEnv(base, saved), saved, unreadable: false, locked: false };
    } catch {
      return { env: base, saved: {}, unreadable: true, locked: false };
    }
  } catch {
    return { env: base, saved: {}, unreadable: true, locked: false };
  }
}
