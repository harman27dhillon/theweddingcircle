import { randomBytes } from "node:crypto";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { codeMatch, compactCode, normalizeCode } from "@/lib/wedding/format";
import type { Wedding } from "@/lib/wedding/types";
import { pickMembership } from "@/lib/wedding/host-identity";

export type AuthorizedRole = "guest" | "family" | "cohost" | "host";

type AuthRow = {
  host_code: string;
  cohost_code: string;
  family_codes: string;
  guest_codes: string;
  edit_key: string;
};

function secret(prefix: string) {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function memberKey() {
  return randomBytes(16).toString("hex");
}

function parseList(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length >= 4);
  } catch {
    return [];
  }
}

function sameCode(left: string, right: string) {
  const a = compactCode(normalizeCode(left));
  const b = compactCode(normalizeCode(right));
  return Boolean(a) && a === b;
}

export function roleFromCode(auth: { hostCode: string; cohostCode: string; familyCodes: string[]; guestCodes: string[] }, code: string): AuthorizedRole | null {
  if (sameCode(auth.hostCode, code)) return "host";
  if (sameCode(auth.cohostCode, code)) return "cohost";
  if (auth.familyCodes.some((item) => sameCode(item, code))) return "family";
  if (auth.guestCodes.some((item) => sameCode(item, code))) return "guest";
  return null;
}

async function ensureTables() {
  const sql = await weddingDataSql();
  await sql`create table if not exists circle_auth (
    slug text primary key,
    host_code text not null,
    cohost_code text not null,
    family_codes text not null,
    guest_codes text not null,
    edit_key text not null
  )`;
  await sql`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    account_id text not null default '',
    primary key (slug, member_key)
  )`;
  await sql`alter table circle_members add column if not exists account_id text not null default ''`;
  return sql;
}

function asRole(value: string): AuthorizedRole | null {
  if (value === "guest" || value === "family" || value === "cohost" || value === "host") return value;
  return null;
}

async function existingEditKey(sql: Awaited<ReturnType<typeof ensureTables>>, slug: string) {
  const circles = await sql<{ edit_key: string }>`select edit_key from circles where slug = ${slug} limit 1`;
  return circles[0]?.edit_key ?? "";
}

export async function registerWeddingAuthority(input: {
  slug: string;
  editKey: string;
  email: string;
  name: string;
  memberKey: string;
  familyCodes: string[];
  guestCodes: string[];
  accountId?: string;
}) {
  const slug = input.slug.trim().toLowerCase();
  const editKey = input.editKey.trim();
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || editKey.length < 16) return { ok: false as const, error: "The host could not be verified." };
  const sql = await ensureTables();
  const published = await existingEditKey(sql, slug);
  if (published && published !== editKey) return { ok: false as const, error: "The host could not be verified." };
  const current = await sql<AuthRow>`select host_code, cohost_code, family_codes, guest_codes, edit_key from circle_auth where slug = ${slug} limit 1`;
  if (current[0] && current[0].edit_key !== editKey) return { ok: false as const, error: "The host could not be verified." };
  const family = JSON.stringify(input.familyCodes.filter(Boolean).slice(0, 20));
  const guest = JSON.stringify(input.guestCodes.filter(Boolean).slice(0, 20));
  const hostCode = current[0]?.host_code || secret("HOST");
  const cohostCode = current[0]?.cohost_code || secret("COHOST");
  if (current[0]) {
    await sql`update circle_auth set family_codes = ${family}, guest_codes = ${guest} where slug = ${slug} and edit_key = ${editKey}`;
  } else {
    await sql`insert into circle_auth (slug, host_code, cohost_code, family_codes, guest_codes, edit_key) values (${slug}, ${hostCode}, ${cohostCode}, ${family}, ${guest}, ${editKey})`;
  }
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 80) || "Host";
  const key = input.memberKey.trim() || memberKey();
  const accountId = (input.accountId || "").trim();
  const people = await sql<{ member_key: string; role: string; email: string; account_id: string }>`select member_key, role, email, account_id from circle_members where slug = ${slug}`;
  const byAccount = accountId ? people.filter((row) => row.account_id === accountId) : [];
  const byKey = people.find((row) => row.member_key === key);
  let target: { member_key: string; role: string; email: string; account_id: string } | undefined = byAccount[0] || byKey;
  if (!target && email) {
    const sameEmail = people.filter((row) => row.email === email && (!row.account_id || !accountId || row.account_id === accountId));
    if (sameEmail.length === 1) target = sameEmail[0];
  }
  if (target && target.account_id && accountId && target.account_id !== accountId && target.role === "host") target = undefined;
  const savedKey = target?.member_key || key;
  if (target) {
    await sql`update circle_members set role = ${"host"}, name = ${name}, email = ${email}, account_id = ${accountId || target.account_id} where slug = ${slug} and member_key = ${savedKey}`;
  } else {
    await sql`insert into circle_members (slug, member_key, email, name, role, account_id) values (${slug}, ${savedKey}, ${email}, ${name}, ${"host"}, ${accountId})`;
  }
  try {
    const circles = await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`;
    const row = circles[0];
    if (row && row.edit_key === editKey && accountId) {
      const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : (row.payload as Record<string, unknown> | null);
      if (payload && typeof payload === "object") {
        const currentOwner = typeof payload.ownerId === "string" ? payload.ownerId : "";
        if (!currentOwner) {
          payload.ownerId = accountId;
          await sql`update circles set payload = ${JSON.stringify(payload)}::jsonb where slug = ${slug} and edit_key = ${editKey}`;
        }
      }
    }
  } catch {
    /* The circle row is written by the wedding save. Membership still records the host. */
  }
  return { ok: true as const, role: "host" as const, memberKey: savedKey, hostCode, cohostCode };
}

export async function syncWeddingCodes(input: { slug: string; editKey: string; familyCodes: string[]; guestCodes: string[] }) {
  const slug = input.slug.trim().toLowerCase();
  const editKey = input.editKey.trim();
  if (editKey.length < 16) return { ok: false as const };
  const sql = await ensureTables();
  const family = JSON.stringify(input.familyCodes.filter(Boolean).slice(0, 20));
  const guest = JSON.stringify(input.guestCodes.filter(Boolean).slice(0, 20));
  const rows = await sql<{ slug: string }>`update circle_auth set family_codes = ${family}, guest_codes = ${guest} where slug = ${slug} and edit_key = ${editKey} returning slug`;
  return { ok: Boolean(rows[0]) as boolean };
}

async function member(sql: Awaited<ReturnType<typeof ensureTables>>, slug: string, key: string, email: string, accountId = "") {
  let people: { member_key: string; role: string; email: string; account_id?: string }[] = [];
  try {
    people = await sql<{ member_key: string; role: string; email: string; account_id: string }>`select member_key, role, email, account_id from circle_members where slug = ${slug}`;
  } catch {
    people = await sql<{ member_key: string; role: string; email: string }>`select member_key, role, email from circle_members where slug = ${slug}`;
  }
  const picked = pickMembership(people, { accountId, memberKey: key, email });
  if (picked.review || !picked.row) return undefined;
  return { member_key: picked.row.member_key, role: picked.row.role, email: picked.row.email, account_id: picked.row.account_id || "" };
}

export async function resolveWeddingRole(input: { slug: string; memberKey: string; email: string; accountId?: string }) {
  const slug = input.slug.trim().toLowerCase();
  const sql = await ensureTables();
  const row = await member(sql, slug, input.memberKey.trim(), input.email.trim().toLowerCase(), (input.accountId || "").trim());
  const role = row ? asRole(row.role) : null;
  if (!row || !role) {
    let people: { member_key: string; role: string; email: string; account_id?: string }[] = [];
    try {
      people = await sql<{ member_key: string; role: string; email: string; account_id: string }>`select member_key, role, email, account_id from circle_members where slug = ${slug}`;
    } catch {
      people = [];
    }
    const picked = pickMembership(people, {
      accountId: (input.accountId || "").trim(),
      memberKey: input.memberKey.trim(),
      email: input.email.trim().toLowerCase(),
    });
    return { ok: true as const, role: null, memberKey: "", review: picked.review };
  }
  return { ok: true as const, role, memberKey: row.member_key, review: false as const };
}

export async function claimWeddingRole(input: { slug: string; memberKey: string; email: string; name: string; code: string }) {
  const slug = input.slug.trim().toLowerCase();
  const code = input.code.trim();
  if (!code) return { ok: false as const, error: "Enter an authorization code." };
  const sql = await ensureTables();
  const rows = await sql<AuthRow>`select host_code, cohost_code, family_codes, guest_codes, edit_key from circle_auth where slug = ${slug} limit 1`;
  const auth = rows[0];
  let granted: AuthorizedRole | null = auth
    ? roleFromCode(
        { hostCode: auth.host_code, cohostCode: auth.cohost_code, familyCodes: parseList(auth.family_codes), guestCodes: parseList(auth.guest_codes) },
        code,
      )
    : null;
  if (!granted) {
    const circles = await sql<{ payload: unknown }>`select payload from circles where slug = ${slug} limit 1`;
    const raw = circles[0]?.payload;
    const wedding = raw
      ? (typeof raw === "string" ? JSON.parse(raw) : raw) as Wedding
      : null;
    const matched = wedding ? codeMatch(wedding, code) : undefined;
    if (matched) granted = matched.kind;
  }
  if (!granted) return { ok: false as const, error: "That code does not match this wedding." };
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 80) || "Guest";
  const key = input.memberKey.trim();
  const existing = await member(sql, slug, key, email);
  const rank: Record<AuthorizedRole, number> = { guest: 1, family: 2, cohost: 3, host: 4 };
  const current = existing ? asRole(existing.role) : null;
  if (current && rank[current] > rank[granted]) return { ok: false as const, error: "That code does not change your role." };
  const savedKey = existing?.member_key || key || memberKey();
  if (existing) {
    await sql`update circle_members set role = ${granted}, name = ${name}, email = ${email || existing.email} where slug = ${slug} and member_key = ${savedKey}`;
  } else {
    await sql`insert into circle_members (slug, member_key, email, name, role) values (${slug}, ${savedKey}, ${email}, ${name}, ${granted})`;
  }
  return { ok: true as const, role: granted, memberKey: savedKey };
}

export async function readHostCodes(input: { slug: string; memberKey: string; email: string }) {
  const slug = input.slug.trim().toLowerCase();
  const sql = await ensureTables();
  const who = await member(sql, slug, input.memberKey.trim(), input.email.trim().toLowerCase());
  if (!who || who.role !== "host") return { ok: false as const, error: "Only the host can see these codes." };
  const rows = await sql<AuthRow>`select host_code, cohost_code, family_codes, guest_codes, edit_key from circle_auth where slug = ${slug} limit 1`;
  if (!rows[0]) return { ok: false as const, error: "Only the host can see these codes." };
  return { ok: true as const, hostCode: rows[0].host_code, cohostCode: rows[0].cohost_code };
}

export async function assignCohosts(input: { slug: string; editKey: string; names: string[] }) {
  const slug = input.slug.trim().toLowerCase();
  const editKey = input.editKey.trim();
  if (editKey.length < 16) return { ok: false as const, error: "Only the host can choose co-hosts." };
  const sql = await ensureTables();
  const circles = await sql<{ edit_key: string; payload: unknown }>`select edit_key, payload from circles where slug = ${slug} limit 1`;
  const row = circles[0];
  if (!row || row.edit_key !== editKey) return { ok: false as const, error: "Only the host can choose co-hosts." };
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : (row.payload as Record<string, unknown> | null);
  if (!payload || typeof payload !== "object") return { ok: false as const, error: "The wedding could not be updated." };
  const hostName = String(payload.hostName ?? "").trim().toLowerCase();
  const guests = Array.isArray(payload.guests) ? payload.guests : [];
  const guestNames = guests.flatMap((guest) => {
    if (!guest || typeof guest !== "object") return [];
    const name = String((guest as { name?: unknown }).name ?? "").trim();
    if (!name || name.toLowerCase() === hostName) return [];
    return [name];
  });
  const requested = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))].slice(0, 2);
  const canonical = requested.map((name) => guestNames.find((guest) => guest.toLowerCase() === name.toLowerCase()) ?? "");
  if (canonical.some((name) => !name)) return { ok: false as const, error: "Choose people who are already in this wedding." };
  payload.cohostNames = canonical;
  const body = JSON.stringify(payload);
  const saved = await sql<{ slug: string }>`update circles set payload = ${body}::jsonb, updated_at = now() where slug = ${slug} and edit_key = ${editKey} returning slug`;
  if (!saved[0]) return { ok: false as const, error: "Only the host can choose co-hosts." };
  const wanted = new Set(canonical.map((name) => name.toLowerCase()));
  const members = await sql<{ member_key: string; name: string; role: string }>`select member_key, name, role from circle_members where slug = ${slug}`;
  for (const memberRow of members) {
    if (memberRow.role === "host") continue;
    const name = memberRow.name.trim().toLowerCase();
    if (wanted.has(name)) {
      if (memberRow.role !== "cohost") {
        await sql`update circle_members set role = ${"cohost"} where slug = ${slug} and member_key = ${memberRow.member_key}`;
      }
    } else if (memberRow.role === "cohost") {
      await sql`update circle_members set role = ${"guest"} where slug = ${slug} and member_key = ${memberRow.member_key}`;
    }
  }
  return { ok: true as const, names: canonical };
}

export async function listMyCircles(input: { email: string; memberKeys: string[]; phone?: string; accountId?: string }) {
  const email = input.email.trim().toLowerCase();
  const digits = (input.phone || "").replace(/\D/g, "");
  const phone = digits.length >= 10 ? digits.slice(-10) : "";
  const circles: { slug: string; memberKey: string; name: string; role: string; editKey: string }[] = [];
  if ((!email || !email.includes("@")) && phone.length !== 10) return { ok: true as const, slugs: [] as string[], circles };
  const sql = await ensureTables();
  const accountId = (input.accountId || "").trim();
  const hits = new Map<string, { slug: string; memberKey: string; name: string; role: string; editKey: string }>();
  if (accountId) {
    try {
      const ownedByAccount = await sql<{ slug: string; member_key: string; name: string; role: string }>`select slug, member_key, name, role from circle_members where account_id = ${accountId}`;
      for (const row of ownedByAccount) {
        if (!row.slug || row.slug === "lila-nico") continue;
        hits.set(row.slug, { slug: row.slug, memberKey: row.member_key, name: row.name, role: row.role, editKey: "" });
      }
    } catch (error) {
      if (!missingRelation(error)) throw error;
    }
  }
  if (email.includes("@")) {
    const rows = await sql<{ slug: string; member_key: string; name: string; role: string; account_id: string }>`select slug, member_key, name, role, account_id from circle_members where lower(email) = ${email}`;
    const grouped = new Map<string, { member_key: string; role: string; email: string; account_id: string; name: string }[]>();
    for (const row of rows) {
      if (!row.slug || row.slug === "lila-nico") continue;
      const list = grouped.get(row.slug) ?? [];
      list.push({ member_key: row.member_key, role: row.role, email: email, account_id: row.account_id || "", name: row.name });
      grouped.set(row.slug, list);
    }
    for (const [slug, list] of grouped) {
      if (hits.has(slug)) continue;
      const picked = pickMembership(list, { accountId, email });
      if (picked.review || !picked.row) continue;
      hits.set(slug, { slug, memberKey: picked.row.member_key, name: list.find((row) => row.member_key === picked.row?.member_key)?.name || "", role: picked.row.role, editKey: "" });
    }
    try {
      const owned = await sql<{ slug: string }>`select slug from circles where lower(payload->>'ownerEmail') = ${email}`;
      for (const row of owned) {
        if (!row.slug || row.slug === "lila-nico" || hits.has(row.slug)) continue;
        const hosts = await sql<{ member_key: string; name: string; email: string; account_id: string }>`select member_key, name, email, account_id from circle_members where slug = ${row.slug} and role = ${"host"}`;
        if (hosts.length > 1) continue;
        const host = hosts[0];
        const hostEmail = (host?.email || "").trim().toLowerCase();
        if (hostEmail && hostEmail !== email) continue;
        hits.set(row.slug, { slug: row.slug, memberKey: host?.member_key || "", name: host?.name || "", role: "host", editKey: "" });
      }
    } catch (error) {
      if (!missingRelation(error)) throw error;
    }
  }
  const emailId = email.includes("@") ? `email:${email}` : "email:none";
  const phoneId = phone.length === 10 ? `phone:${phone}` : "phone:none";
  try {
    const couples = await sql<{ slug: string; bride_account: string; bride_name: string; groom_account: string; groom_name: string }>`
      select slug, bride_account, bride_name, groom_account, groom_name from couple_access
      where bride_account = ${emailId} or bride_account = ${phoneId} or groom_account = ${emailId} or groom_account = ${phoneId}
    `;
    for (const row of couples) {
      if (!row.slug || row.slug === "lila-nico" || hits.has(row.slug)) continue;
      const bride = row.bride_account === emailId || row.bride_account === phoneId;
      hits.set(row.slug, { slug: row.slug, memberKey: "", name: bride ? row.bride_name : row.groom_name, role: bride ? "bride" : "groom", editKey: "" });
    }
  } catch (error) {
    if (!missingRelation(error)) throw error;
  }
  for (const hit of hits.values()) {
    if (hit.role !== "host") continue;
    try {
      const keys = await sql<{ edit_key: string }>`select edit_key from circles where slug = ${hit.slug} limit 1`;
      const key = keys[0]?.edit_key || "";
      if (key.length >= 16) hit.editKey = key;
    } catch (error) {
      if (!missingRelation(error)) throw error;
    }
  }
  const listed = [...hits.values()].slice(0, 40);
  return { ok: true as const, slugs: listed.map((item) => item.slug), circles: listed };
}

function missingRelation(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
  const message = error instanceof Error ? error.message : "";
  return code === "42P01" || /does not exist/i.test(message);
}
