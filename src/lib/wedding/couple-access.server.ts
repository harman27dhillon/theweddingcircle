import { type Sql } from "@/lib/db";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { claimCoupleCode, compactCoupleCode, coupleAccessForPublish } from "@/lib/wedding/couple-access";
import type { CoupleAccess, CoupleCodeStatus, CoupleRoleName } from "@/lib/wedding/types";

const attempts = new Map<string, { n: number; at: number }>();

function limited(key: string) {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || now - row.at > 10 * 60 * 1000) {
    attempts.set(key, { n: 1, at: now });
    return false;
  }
  row.n += 1;
  return row.n > 8;
}

async function ensure(sql: Sql) {
  await sql`create table if not exists couple_access (
    slug text primary key,
    bride_code text not null default '',
    bride_status text not null default '',
    bride_claimed text not null default '',
    bride_account text not null default '',
    bride_name text not null default '',
    groom_code text not null default '',
    groom_status text not null default '',
    groom_claimed text not null default '',
    groom_account text not null default '',
    groom_name text not null default ''
  )`;
}

function statusOf(value: string): CoupleCodeStatus | "" {
  if (value === "active" || value === "claimed" || value === "revoked") return value;
  return "";
}

type Row = {
  slug: string;
  bride_code: string;
  bride_status: string;
  bride_claimed: string;
  bride_account: string;
  bride_name: string;
  groom_code: string;
  groom_status: string;
  groom_claimed: string;
  groom_account: string;
  groom_name: string;
};

function accessFromRow(row: Row): CoupleAccess {
  const access: CoupleAccess = {};
  if (row.bride_account) access.bride = { accountId: row.bride_account, name: row.bride_name };
  if (row.groom_account) access.groom = { accountId: row.groom_account, name: row.groom_name };
  const brideStatus = statusOf(row.bride_status);
  if (row.bride_code || brideStatus) {
    access.brideCode = { code: row.bride_code, status: brideStatus || "active", claimedBy: row.bride_claimed || undefined };
  }
  const groomStatus = statusOf(row.groom_status);
  if (row.groom_code || groomStatus) {
    access.groomCode = { code: row.groom_code, status: groomStatus || "active", claimedBy: row.groom_claimed || undefined };
  }
  return access;
}

async function writeSeats(sql: Sql, slug: string, access: CoupleAccess) {
  const rows = await sql<{ payload: unknown }>`select payload from circles where slug = ${slug} limit 1`;
  const payload = rows[0]?.payload;
  if (!payload) return;
  const body = typeof payload === "string" ? (JSON.parse(payload) as Record<string, unknown>) : { ...(payload as Record<string, unknown>) };
  body.coupleAccess = coupleAccessForPublish(access) ?? null;
  await sql`update circles set payload = ${JSON.stringify(body)}::jsonb, updated_at = now() where slug = ${slug}`;
}

export async function saveCoupleSecrets(input: { slug: string; editKey: string; access: CoupleAccess }) {
  const slug = input.slug.trim().toLowerCase();
  const editKey = input.editKey.trim();
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || editKey.length < 16) return { ok: false as const, error: "Only a host can save these codes." };
  const sql = await weddingDataSql();
  await ensure(sql);
  const circles = await sql<{ edit_key: string }>`select edit_key from circles where slug = ${slug} limit 1`;
  if (!circles[0] || circles[0].edit_key !== editKey) return { ok: false as const, error: "These codes stay on this phone until the wedding is published." };
  const access = input.access ?? {};
  const brideCode = access.brideCode?.code?.trim().toUpperCase() ?? "";
  const groomCode = access.groomCode?.code?.trim().toUpperCase() ?? "";
  await sql`insert into couple_access (
      slug, bride_code, bride_status, bride_claimed, bride_account, bride_name,
      groom_code, groom_status, groom_claimed, groom_account, groom_name
    ) values (
      ${slug},
      ${brideCode},
      ${access.brideCode?.status ?? ""},
      ${access.brideCode?.claimedBy ?? ""},
      ${access.bride?.accountId ?? ""},
      ${(access.bride?.name ?? "").slice(0, 80)},
      ${groomCode},
      ${access.groomCode?.status ?? ""},
      ${access.groomCode?.claimedBy ?? ""},
      ${access.groom?.accountId ?? ""},
      ${(access.groom?.name ?? "").slice(0, 80)}
    )
    on conflict (slug) do update set
      bride_code = ${brideCode},
      bride_status = ${access.brideCode?.status ?? ""},
      bride_claimed = ${access.brideCode?.claimedBy ?? ""},
      bride_account = ${access.bride?.accountId ?? ""},
      bride_name = ${(access.bride?.name ?? "").slice(0, 80)},
      groom_code = ${groomCode},
      groom_status = ${access.groomCode?.status ?? ""},
      groom_claimed = ${access.groomCode?.claimedBy ?? ""},
      groom_account = ${access.groom?.accountId ?? ""},
      groom_name = ${(access.groom?.name ?? "").slice(0, 80)}`;
  await writeSeats(sql, slug, access);
  return { ok: true as const };
}

export async function claimCoupleSecret(input: { code: string; accountId: string; name: string }) {
  const compact = compactCoupleCode(input.code);
  const accountId = input.accountId.trim();
  if (compact.length < 12 || !accountId.startsWith("email:") && !accountId.startsWith("phone:")) {
    return { ok: false as const, error: "invalid" as const };
  }
  if (limited(compact)) return { ok: false as const, error: "slow" as const };
  const sql = await weddingDataSql();
  await ensure(sql);
  const rows = await sql<Row>`select slug, bride_code, bride_status, bride_claimed, bride_account, bride_name, groom_code, groom_status, groom_claimed, groom_account, groom_name from couple_access`;
  const hit = rows.find((row) => compactCoupleCode(row.bride_code) === compact || compactCoupleCode(row.groom_code) === compact);
  if (!hit) return { ok: false as const, error: "invalid" as const };
  const circles = await sql<{ payload: unknown }>`select payload from circles where slug = ${hit.slug} limit 1`;
  const payload = circles[0]?.payload;
  if (!payload) return { ok: false as const, error: "invalid" as const };
  const body = typeof payload === "string" ? (JSON.parse(payload) as { disabled?: boolean }) : (payload as { disabled?: boolean });
  if (body?.disabled) return { ok: false as const, error: "paused" as const };
  const role: CoupleRoleName = compactCoupleCode(hit.bride_code) === compact ? "bride" : "groom";
  const access = accessFromRow(hit);
  const claimed = claimCoupleCode(access, input.code, accountId, input.name);
  if (!claimed.ok) {
    if (claimed.error === "unsigned") return { ok: false as const, error: "invalid" as const };
    return { ok: false as const, error: claimed.error };
  }
  attempts.delete(compact);
  await saveRow(sql, hit.slug, claimed.access);
  await writeSeats(sql, hit.slug, claimed.access);
  return { ok: true as const, slug: hit.slug, role: claimed.role };
}

async function saveRow(sql: Sql, slug: string, access: CoupleAccess) {
  const brideCode = access.brideCode?.code?.trim().toUpperCase() ?? "";
  const groomCode = access.groomCode?.code?.trim().toUpperCase() ?? "";
  await sql`update couple_access set
    bride_code = ${brideCode},
    bride_status = ${access.brideCode?.status ?? ""},
    bride_claimed = ${access.brideCode?.claimedBy ?? ""},
    bride_account = ${access.bride?.accountId ?? ""},
    bride_name = ${(access.bride?.name ?? "").slice(0, 80)},
    groom_code = ${groomCode},
    groom_status = ${access.groomCode?.status ?? ""},
    groom_claimed = ${access.groomCode?.claimedBy ?? ""},
    groom_account = ${access.groom?.accountId ?? ""},
    groom_name = ${(access.groom?.name ?? "").slice(0, 80)}
    where slug = ${slug}`;
}
