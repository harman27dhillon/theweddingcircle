import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import { canIssueInvite, snapshotCeremonies, type CeremonySnapshot, type InviteKind } from "@/lib/wedding/ceremony-invite";
import { claimCoupleCode, coupleAccessForPublish } from "@/lib/wedding/couple-access";
import { codesOf, isSampleCircle } from "@/lib/wedding/format";
import type { CoupleAccess, CoupleCodeStatus, CoupleRoleName } from "@/lib/wedding/types";

const TOKEN = /^[A-Za-z0-9_-]{43,80}$/;
const SLUG = /^[a-z0-9-]{3,80}$/;
const CODE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MEMBER = /^[A-Za-z0-9_-]{8,64}$/;
const ACCOUNT = /^(email|phone):[A-Za-z0-9@._+-]{3,160}$/;

export type InviteStatus = "active" | "expired" | "revoked" | "missing";

export type InviteView =
  | {
      ok: true;
      status: "active";
      bride: string;
      groom: string;
      city: string;
      date: string;
      theme: string;
      kind: InviteKind;
      ceremonies: CeremonySnapshot[];
      expiresAt: string;
      paused: boolean;
    }
  | { ok: false; status: Exclude<InviteStatus, "active"> };

type InviteRow = {
  token: string;
  slug: string;
  code_kind: string;
  code_id: string;
  ceremonies: unknown;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  expired: boolean | string | number;
};

let sqlOverride: Sql | null = null;

/** Test-only. The app path always uses the shared server database. */
export function bindCeremonyInviteSql(sql: Sql | null) {
  sqlOverride = sql;
}

async function db() {
  if (sqlOverride) return sqlOverride;
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  return weddingDataSql();
}

async function ensure(sql: Sql) {
  await sql`create table if not exists ceremony_invites (
    token text primary key,
    slug text not null,
    code_kind text not null,
    code_id text not null,
    ceremonies jsonb not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz
  )`;
  await sql`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`;
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

function cleanSlug(value: unknown) {
  if (typeof value !== "string") return "";
  const slug = value.trim().toLowerCase();
  return SLUG.test(slug) ? slug : "";
}

function cleanToken(value: unknown) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  return TOKEN.test(token) ? token : "";
}

function asKind(value: unknown): InviteKind | null {
  if (value === "family" || value === "guest" || value === "bride" || value === "groom") return value;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function ceremoniesOf(value: unknown): CeremonySnapshot[] {
  const parsed = typeof value === "string" ? asRecord(value) : value;
  const list = Array.isArray(parsed) ? parsed : [];
  return snapshotCeremonies(list, list.flatMap((item) => (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : [])));
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function loadInvite(sql: Sql, token: string): Promise<InviteRow | undefined> {
  const rows = await sql<InviteRow>`
    select token, slug, code_kind, code_id, ceremonies, created_at, expires_at, revoked_at,
      (expires_at <= now()) as expired
    from ceremony_invites
    where token = ${token}
    limit 1
  `;
  return rows[0];
}

async function dropExpired(sql: Sql) {
  await sql`delete from ceremony_invites where expires_at <= now() - interval '7 days'`;
}

function statusOf(row: InviteRow | undefined): InviteStatus {
  if (!row) return "missing";
  const flag = row.expired === true || row.expired === "t" || String(row.expired) === "true";
  const expires = row.expires_at instanceof Date ? row.expires_at.getTime() : new Date(row.expires_at).getTime();
  if (flag || (Number.isFinite(expires) && expires <= Date.now())) return "expired";
  if (row.revoked_at) return "revoked";
  return "active";
}

async function circlePayload(sql: Sql, slug: string) {
  const rows = await sql<{ payload: unknown; edit_key: string }>`select payload, edit_key from circles where slug = ${slug} limit 1`;
  const row = rows[0];
  if (!row) return null;
  const payload = asRecord(row.payload);
  if (!payload) return null;
  return { payload, editKey: row.edit_key ?? "" };
}

function publicView(row: InviteRow, payload: Record<string, unknown>): InviteView {
  const kind = asKind(row.code_kind);
  if (!kind) return { ok: false, status: "missing" };
  const theme = typeof payload.cardTheme === "string" ? payload.cardTheme.slice(0, 40) : "";
  return {
    ok: true,
    status: "active",
    bride: typeof payload.bride === "string" ? payload.bride.slice(0, 80) : "",
    groom: typeof payload.groom === "string" ? payload.groom.slice(0, 80) : "",
    city: typeof payload.city === "string" ? payload.city.slice(0, 80) : "",
    date: typeof payload.date === "string" ? payload.date.slice(0, 32) : "",
    theme,
    kind,
    ceremonies: ceremoniesOf(row.ceremonies),
    expiresAt: iso(row.expires_at),
    paused: Boolean(payload.disabled),
  };
}

export async function readCeremonyInvite(tokenValue: string): Promise<InviteView> {
  const token = cleanToken(tokenValue);
  if (!token) return { ok: false, status: "missing" };
  const sql = await db();
  await ensure(sql);
  const row = await loadInvite(sql, token);
  const status = statusOf(row);
  if (status === "expired") {
    await dropExpired(sql);
    return { ok: false, status: "expired" };
  }
  if (!row || status !== "active") return { ok: false, status: status === "active" ? "missing" : status };
  const circle = await circlePayload(sql, row.slug);
  if (!circle || isSampleCircle({ slug: row.slug })) return { ok: false, status: "missing" };
  return publicView(row, circle.payload);
}

export async function revokeCeremonyInvite(tokenValue: string): Promise<{ ok: boolean }> {
  const token = cleanToken(tokenValue);
  if (!token) return { ok: false };
  const sql = await db();
  await ensure(sql);
  const rows = await sql<{ token: string }>`
    update ceremony_invites
    set revoked_at = now()
    where token = ${token} and revoked_at is null and expires_at > now()
    returning token
  `;
  return { ok: Boolean(rows[0]) };
}

type Actor = { host: boolean; family: boolean; bride: boolean; groom: boolean };

async function actorOf(sql: Sql, slug: string, editKey: string, input: { editKey: string; memberKey: string; accountId: string }): Promise<Actor> {
  const hostByEdit = Boolean(input.editKey && input.editKey.length >= 16 && input.editKey === editKey);
  let memberRole = "";
  if (MEMBER.test(input.memberKey)) {
    const member = await sql<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${input.memberKey} limit 1`;
    memberRole = member[0]?.role ?? "";
  }
  let bride = false;
  let groom = false;
  if (ACCOUNT.test(input.accountId)) {
    const couple = await sql<{ bride_account: string; groom_account: string }>`select bride_account, groom_account from couple_access where slug = ${slug} limit 1`;
    bride = couple[0]?.bride_account === input.accountId;
    groom = couple[0]?.groom_account === input.accountId;
  }
  return {
    host: hostByEdit || memberRole === "host" || memberRole === "cohost",
    family: memberRole === "family",
    bride,
    groom,
  };
}

function codeStillThere(payload: Record<string, unknown>, slug: string, codeId: string, kind: "family" | "guest") {
  const postingCodes = Array.isArray(payload.postingCodes) ? payload.postingCodes : [];
  return codesOf({ slug, postingCodes }).some((item) => item.id === codeId && item.kind === kind);
}

type CoupleRow = {
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

function coupleStatus(value: string): CoupleCodeStatus | "" {
  if (value === "active" || value === "claimed" || value === "revoked") return value;
  return "";
}

function accessFromCouple(row: CoupleRow): CoupleAccess {
  const access: CoupleAccess = {};
  if (row.bride_account) access.bride = { accountId: row.bride_account, name: row.bride_name };
  if (row.groom_account) access.groom = { accountId: row.groom_account, name: row.groom_name };
  const brideStatus = coupleStatus(row.bride_status);
  if (row.bride_code || brideStatus) access.brideCode = { code: row.bride_code, status: brideStatus || "active", claimedBy: row.bride_claimed || undefined };
  const groomStatus = coupleStatus(row.groom_status);
  if (row.groom_code || groomStatus) access.groomCode = { code: row.groom_code, status: groomStatus || "active", claimedBy: row.groom_claimed || undefined };
  return access;
}

async function coupleRow(sql: Sql, slug: string) {
  const rows = await sql<CoupleRow>`
    select bride_code, bride_status, bride_claimed, bride_account, bride_name,
      groom_code, groom_status, groom_claimed, groom_account, groom_name
    from couple_access where slug = ${slug} limit 1
  `;
  return rows[0];
}

export async function createCeremonyInvite(input: {
  slug: string;
  editKey: string;
  memberKey: string;
  accountId: string;
  codeId: string;
  kind: string;
  ceremonyIds: string[];
}): Promise<{ ok: true; token: string; expiresAt: string; ceremonies: CeremonySnapshot[] } | { ok: false; error: string }> {
  const slug = cleanSlug(input.slug);
  const kind = asKind(input.kind);
  const codeId = CODE_ID.test(input.codeId) ? input.codeId : "";
  if (!slug || !kind || !codeId || isSampleCircle({ slug })) return { ok: false, error: "That invitation could not be created." };
  const sql = await db();
  await ensure(sql);
  const circle = await circlePayload(sql, slug);
  if (!circle) return { ok: false, error: "Publish the wedding before sharing this invitation." };
  const actor = await actorOf(sql, slug, circle.editKey, input);
  if (!canIssueInvite(actor, kind)) return { ok: false, error: "You cannot share an invitation for that access code." };
  if (kind === "family" || kind === "guest") {
    if (!codeStillThere(circle.payload, slug, codeId, kind)) return { ok: false, error: "That access code is no longer available." };
  } else {
    const couple = await coupleRow(sql, slug);
    const secret = kind === "bride" ? couple?.bride_code : couple?.groom_code;
    const state = kind === "bride" ? couple?.bride_status : couple?.groom_status;
    if (codeId !== kind || !secret || state === "revoked") return { ok: false, error: "That access code is not active." };
  }
  const ids = input.ceremonyIds.filter((id) => CODE_ID.test(id)).slice(0, 40);
  const before = JSON.stringify(circle.payload.functions ?? null);
  const ceremonies = snapshotCeremonies(circle.payload.functions, ids);
  if (JSON.stringify(circle.payload.functions ?? null) !== before) return { ok: false, error: "That invitation could not be created." };
  const token = randomBytes(32).toString("base64url");
  const saved = await sql<{ expires_at: Date | string }>`
    insert into ceremony_invites (token, slug, code_kind, code_id, ceremonies, expires_at)
    values (${token}, ${slug}, ${kind}, ${codeId}, ${JSON.stringify(ceremonies)}::jsonb, now() + interval '24 hours')
    returning expires_at
  `;
  await dropExpired(sql);
  const expiresAt = saved[0] ? iso(saved[0].expires_at) : "";
  return { ok: true, token, expiresAt, ceremonies };
}

const RANK: Record<string, number> = { guest: 1, family: 2, cohost: 3, host: 4 };

async function grantMember(sql: Sql, slug: string, memberKey: string, name: string, granted: "family" | "guest") {
  const key = MEMBER.test(memberKey) ? memberKey : randomBytes(16).toString("hex");
  const existing = await sql<{ role: string }>`select role from circle_members where slug = ${slug} and member_key = ${key} limit 1`;
  const current = existing[0]?.role ?? "";
  const next = current && (RANK[current] ?? 0) > RANK[granted] ? current : granted;
  if (existing[0]) {
    if (next !== current) await sql`update circle_members set role = ${next}, name = ${name} where slug = ${slug} and member_key = ${key}`;
  } else {
    await sql`insert into circle_members (slug, member_key, email, name, role) values (${slug}, ${key}, ${""}, ${name}, ${next})`;
  }
  const role = next === "host" || next === "cohost" || next === "family" || next === "guest" ? next : granted;
  return { role: role as "guest" | "family" | "host" | "cohost", memberKey: key };
}

async function saveCouple(sql: Sql, slug: string, access: CoupleAccess) {
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
  const rows = await sql<{ payload: unknown }>`select payload from circles where slug = ${slug} limit 1`;
  const payload = asRecord(rows[0]?.payload);
  if (!payload) return;
  payload.coupleAccess = coupleAccessForPublish(access) ?? null;
  await sql`update circles set payload = ${JSON.stringify(payload)}::jsonb, updated_at = now() where slug = ${slug}`;
}

export async function enterCeremonyInvite(input: {
  token: string;
  name: string;
  side: string;
  memberKey: string;
  accountId: string;
}): Promise<
  | { ok: true; slug: string; role: "guest" | "family" | "host" | "cohost" | CoupleRoleName; memberKey: string }
  | { ok: false; error: string }
> {
  const token = cleanToken(input.token);
  if (!token) return { ok: false, error: "This invitation link is not valid." };
  const sql = await db();
  await ensure(sql);
  const row = await loadInvite(sql, token);
  const status = statusOf(row);
  if (status === "expired") {
    await dropExpired(sql);
    return { ok: false, error: "This invitation link has expired." };
  }
  if (status === "revoked") return { ok: false, error: "This invitation link is no longer active." };
  if (!row || status !== "active") return { ok: false, error: "This invitation link is not valid." };
  const kind = asKind(row.code_kind);
  const circle = await circlePayload(sql, row.slug);
  if (!kind || !circle || isSampleCircle({ slug: row.slug })) return { ok: false, error: "This invitation link is not valid." };
  if (circle.payload.disabled) return { ok: false, error: "This wedding circle is paused." };
  const name = input.name.trim().slice(0, 80);
  if (kind === "bride" || kind === "groom") {
    if (!ACCOUNT.test(input.accountId)) return { ok: false, error: "Sign in before entering as the bride or groom." };
    const couple = await coupleRow(sql, row.slug);
    if (!couple || row.code_id !== kind) return { ok: false, error: "That access code is no longer available." };
    const secret = kind === "bride" ? couple.bride_code : couple.groom_code;
    const claimed = claimCoupleCode(accessFromCouple(couple), secret, input.accountId, name || (kind === "bride" ? "Bride" : "Groom"));
    if (!claimed.ok || claimed.role !== kind) {
      if (claimed.ok) return { ok: false, error: "That access code is no longer available." };
      if (claimed.error === "claimed") return { ok: false, error: "That role was already claimed." };
      if (claimed.error === "revoked") return { ok: false, error: "That bride or groom code was revoked." };
      if (claimed.error === "both") return { ok: false, error: "This account is already the other role for that wedding." };
      return { ok: false, error: "That access code is no longer available." };
    }
    await saveCouple(sql, row.slug, claimed.access);
    return { ok: true, slug: row.slug, role: claimed.role, memberKey: "" };
  }
  if (input.side !== "Bride" && input.side !== "Groom") return { ok: false, error: "Choose bride's side or groom's side." };
  if (!name) return { ok: false, error: "Add your name." };
  if (!codeStillThere(circle.payload, row.slug, row.code_id, kind)) return { ok: false, error: "That access code is no longer available." };
  const granted = await grantMember(sql, row.slug, input.memberKey, name, kind);
  return { ok: true, slug: row.slug, role: granted.role, memberKey: granted.memberKey };
}
