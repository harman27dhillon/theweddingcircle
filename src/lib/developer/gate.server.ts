import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";

const COOKIE = "wc_dev";
const SESSION_HOURS = 12;

const DEVELOPER_EMAILS = ["developer@weddingcircle.app", "singhsaab6812@gmail.com"];
const DEVELOPER_PASSWORD_HASH = "3aa2ee3c2f232c1dd47a2246402f34c2190663dcf5f57572f034abd66c796717";

export function developerEmails() {
  return [...DEVELOPER_EMAILS];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sameHex(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function id() {
  return randomBytes(16).toString("hex");
}

export async function unlockDeveloper(email: string, password: string) {
  const clean = email.trim().toLowerCase();
  if (!DEVELOPER_EMAILS.includes(clean) || !sameHex(sha256(password), DEVELOPER_PASSWORD_HASH)) {
    return { ok: false as const, error: "That developer sign-in was not accepted." };
  }
  const sql = await getSql();
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const sessionId = id();
  const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await sql`delete from developer_sessions where expires_at < now()`;
  await sql`insert into developer_sessions (id, email, token_hash, expires_at) values (${sessionId}, ${clean}, ${tokenHash}, ${expires})`;
  setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 60 * 60 });
  await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${id()}, ${clean}, ${"Unlock command center"}, ${"Server session opened."}, ${"green"}, ${"session"}, ${"ok"})`;
  return { ok: true as const, token, email: clean, expires };
}

export async function lockDeveloper(token: string) {
  const session = await developerSession(token);
  const sql = await getSql();
  const current = token || getCookie(COOKIE) || "";
  if (current) await sql`delete from developer_sessions where token_hash = ${sha256(current)}`;
  setCookie(COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  if (session) {
    await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${id()}, ${session.email}, ${"Lock command center"}, ${"Server session closed."}, ${"green"}, ${"session"}, ${"ok"})`;
  }
  return { ok: true as const };
}

export async function developerSession(token = "") {
  const current = token || getCookie(COOKIE) || "";
  if (!current) return null;
  const sql = await getSql();
  const rows = await sql<{ email: string; expires_at: string }>`
    select email, expires_at from developer_sessions where token_hash = ${sha256(current)} and expires_at > now() limit 1
  `;
  const row = rows[0];
  if (!row || !DEVELOPER_EMAILS.includes(row.email)) return null;
  return { email: row.email };
}

export async function requireDeveloper(token = "") {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  return { ok: true as const, email: session.email };
}
