import { developerEmails } from "@/lib/developer/gate.server";
import { createHash } from "node:crypto";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { readFirebaseIdentity } from "@/lib/wedding/firebase-identity.server";

type Sql = Awaited<ReturnType<typeof weddingDataSql>>;

export type CloudAccount = {
  id: string;
  name: string;
  email: string;
  phone: string;
  country: string;
};

function emailOf(value: string) {
  const email = value.trim().toLowerCase();
  return email.includes("@") && email.length <= 120 ? email : "";
}

function phoneOf(value: string) {
  const digits = value.replace(/\D/g, "");
  const phone = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return phone.length === 10 ? phone : "";
}

function cleanName(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function firebaseMarker(uid: string) {
  return `firebase:${createHash("sha256").update(uid).digest("hex")}`;
}

async function ensure(sql: Sql) {
  await sql`create table if not exists circle_accounts (
    id text primary key,
    email text not null default '',
    phone text not null default '',
    name text not null default '',
    password_hash text not null,
    country text not null default '',
    updated_at timestamptz not null default now()
  )`;
  await sql`create unique index if not exists circle_accounts_email_idx on circle_accounts (email) where email <> ''`;
  await sql`create unique index if not exists circle_accounts_phone_idx on circle_accounts (phone) where phone <> ''`;
  await sql`alter table circle_accounts add column if not exists firebase_uid text not null default ''`;
  await sql`create unique index if not exists circle_accounts_firebase_uid_idx on circle_accounts (firebase_uid) where firebase_uid <> ''`;
}

async function find(sql: Sql, email: string, phone: string) {
  if (email) {
    const rows = await sql<{ id: string; email: string; phone: string; name: string; password_hash: string; country: string; firebase_uid: string }>`
      select id, email, phone, name, password_hash, country, firebase_uid from circle_accounts where email = ${email} limit 1
    `;
    if (rows[0]) return rows[0];
  }
  if (phone) {
    const rows = await sql<{ id: string; email: string; phone: string; name: string; password_hash: string; country: string; firebase_uid: string }>`
      select id, email, phone, name, password_hash, country, firebase_uid from circle_accounts where phone = ${phone} limit 1
    `;
    if (rows[0]) return rows[0];
  }
  return null;
}

function publicAccount(row: { id: string; name: string; email: string; phone: string; country: string }): CloudAccount {
  return {
    id: row.id,
    name: cleanName(row.name) || "Guest",
    email: row.email || "",
    phone: row.phone || "",
    country: (row.country || "").slice(0, 80),
  };
}

export async function publishCircleAccount(input: {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  country: string;
}) {
  const email = emailOf(input.email);
  const phone = phoneOf(input.phone);
  const hash = input.passwordHash.trim();
  if ((!email && !phone) || hash.length < 40 || hash.length > 128 || hash.startsWith("google:")) {
    return { ok: false as const, error: "missing" as const };
  }
  const sql = await weddingDataSql();
  await ensure(sql);
  const existing = await find(sql, email, phone);
  const name = cleanName(input.name) || "Guest";
  const country = input.country.trim().slice(0, 80);
  if (existing) {
    if (existing.password_hash !== hash) return { ok: false as const, error: "exists" as const };
    await sql`update circle_accounts set name = ${name}, country = ${country}, email = ${email || existing.email}, phone = ${phone || existing.phone}, updated_at = now() where id = ${existing.id}`;
    if (input.id && input.id !== existing.id && email) {
      try {
        await sql`update circle_members set account_id = ${existing.id} where lower(email) = ${email} and account_id = ${input.id}`;
      } catch {
        /* The membership table is created with the wedding. The email lookup still finds the host. */
      }
    }
    return { ok: true as const, account: publicAccount({ ...existing, name, country, email: email || existing.email, phone: phone || existing.phone }) };
  }
  const id = /^[A-Za-z0-9_-]{16,80}$/.test(input.id) ? input.id : crypto.randomUUID();
  await sql`insert into circle_accounts (id, email, phone, name, password_hash, country) values (${id}, ${email}, ${phone}, ${name}, ${hash}, ${country})`;
  return { ok: true as const, account: publicAccount({ id, name, email, phone, country }) };
}

/** Password hashes no longer open an account. Sign-in goes through Firebase. */
export async function openCircleAccount(_input: { identifier: string; passwordHash: string }) {
  return { ok: false as const, error: "bad" as const };
}

/**
 * Links a Firebase user to the existing Supabase account with the same email.
 * An existing stored password is left as it is. No row is deleted, and an email that already exists does not get a second row.
 * Wedding access still requires a verified ID token.
 */
export async function linkFirebaseAccount(input: { idToken: string; name: string; country: string; phone: string }) {
  const verified = await readFirebaseIdentity(input.idToken);
  if (!verified.ok) return { ok: false as const, error: "bad" as const, reason: verified.reason };
  const email = emailOf(verified.identity.email);
  if (developerEmails().includes(email)) {
    return { ok: false as const, error: "developer-email" as const, reason: "Use Developer sign-in for this email." };
  }
  const uid = verified.identity.uid.trim();
  if (!email || !uid) return { ok: false as const, error: "no-email" as const, reason: "This Firebase user has no email address." };
  const sql = await weddingDataSql();
  await ensure(sql);
  const name = cleanName(input.name) || "Guest";
  const country = input.country.trim().slice(0, 80);
  const phone = phoneOf(input.phone);
  const existing = await find(sql, email, "");
  if (existing) {
    if (existing.firebase_uid && existing.firebase_uid !== uid) {
      return { ok: false as const, error: "linked-other" as const, reason: "That email is already linked to a different sign-in. The password was not changed." };
    }
    if (!existing.firebase_uid) {
      await sql`update circle_accounts set firebase_uid = ${uid}, updated_at = now() where id = ${existing.id} and firebase_uid = ''`;
    }
    const nextName = existing.name || name;
    const nextCountry = existing.country || country;
    const nextPhone = existing.phone || phone;
    if (nextName !== existing.name || nextCountry !== existing.country || nextPhone !== existing.phone) {
      await sql`update circle_accounts set name = ${nextName}, country = ${nextCountry}, phone = ${nextPhone}, updated_at = now() where id = ${existing.id}`;
    }
    return { ok: true as const, uid, account: publicAccount({ ...existing, name: nextName, country: nextCountry, phone: nextPhone, email }) };
  }
  const taken = await sql<{ id: string }>`select id from circle_accounts where firebase_uid = ${uid} limit 1`;
  if (taken[0]) return { ok: false as const, error: "linked-other" as const, reason: "That sign-in is already linked to another email. No second account was created." };
  const id = crypto.randomUUID();
  const marker = firebaseMarker(uid);
  await sql`insert into circle_accounts (id, email, phone, name, password_hash, country, firebase_uid) values (${id}, ${email}, ${phone}, ${name}, ${marker}, ${country}, ${uid})`;
  return { ok: true as const, uid, account: publicAccount({ id, name, email, phone, country }) };
}
