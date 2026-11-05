import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env.server";

const COOKIE = "wc_dev";
const SESSION_HOURS = 12;
const RECOVERY_SECONDS = 60 * 60;
const RECOVERY_TOKEN = "recovery";
const RECOVERY_PREFIX = `${RECOVERY_TOKEN}.`;

const DEVELOPER_LOGIN_EMAIL = "circle.admin@weddingcircle.app";
const RESERVED_DEVELOPER_EMAILS = [DEVELOPER_LOGIN_EMAIL, "developer@weddingcircle.app", "singhsaab6812@gmail.com"];
const DEVELOPER_PASSWORD_HASH = "bb0cbeb99028b9679835f8c3d8456df8e4c9e14d63bfa87736a80f55bf37bc1a";

export function developerEmails() {
  return [...RESERVED_DEVELOPER_EMAILS];
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

function recoverySignature(payload: string) {
  const secret = env("DEVELOPER_SESSION_SECRET") || env("BETTER_AUTH_SECRET") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || secret.length < 32) return null;
  return createHmac("sha256", secret)
    .update(`wedding-circle/developer-recovery:${DEVELOPER_LOGIN_EMAIL}:${DEVELOPER_PASSWORD_HASH}:${payload}`)
    .digest("hex");
}

function recoverySession(cookie: string) {
  const match = /^recovery\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(cookie);
  if (!match || Number(match[1]) <= Date.now()) return null;
  const expected = recoverySignature(`${match[1]}.${match[2]}`);
  return expected && sameHex(match[3], expected) ? { email: DEVELOPER_LOGIN_EMAIL } : null;
}

function openRecoverySession(email: string) {
  const expiresAt = Date.now() + RECOVERY_SECONDS * 1000;
  const payload = `${expiresAt}.${id()}`;
  const signature = recoverySignature(payload);
  if (!signature) {
    return { ok: false as const, error: "The database is unavailable. Set a server-side developer session secret to enable temporary access." };
  }
  setCookie(COOKIE, `${RECOVERY_PREFIX}${payload}.${signature}`, {
    path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: RECOVERY_SECONDS,
  });
  return { ok: true as const, token: RECOVERY_TOKEN, email, expires: new Date(expiresAt).toISOString() };
}

export async function unlockDeveloper(email: string, password: string) {
  const clean = email.trim().toLowerCase();
  if (clean !== DEVELOPER_LOGIN_EMAIL || !sameHex(sha256(password), DEVELOPER_PASSWORD_HASH)) {
    return { ok: false as const, error: "That developer sign-in was not accepted." };
  }
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const sessionId = id();
  const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  try {
    const sql = await getSql();
    await sql`delete from developer_sessions where expires_at < now()`;
    await sql`insert into developer_sessions (id, email, token_hash, expires_at) values (${sessionId}, ${clean}, ${tokenHash}, ${expires})`;
    await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${id()}, ${clean}, ${"Unlock command center"}, ${"Server session opened."}, ${"green"}, ${"session"}, ${"ok"})`;
  } catch {
    return openRecoverySession(clean);
  }
  setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: SESSION_HOURS * 60 * 60 });
  return { ok: true as const, token, email: clean, expires };
}

export async function lockDeveloper(token: string) {
  if (token === RECOVERY_TOKEN || (!token && getCookie(COOKIE)?.startsWith(RECOVERY_PREFIX))) {
    setCookie(COOKIE, "", { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge: 0 });
    return { ok: true as const };
  }
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
  const cookie = getCookie(COOKIE) || "";
  if (token === RECOVERY_TOKEN || (!token && cookie.startsWith(RECOVERY_PREFIX))) return recoverySession(cookie);
  const current = token || cookie;
  if (!current) return null;
  const sql = await getSql();
  const rows = await sql<{ email: string; expires_at: string }>`
    select email, expires_at from developer_sessions where token_hash = ${sha256(current)} and expires_at > now() limit 1
  `;
  const row = rows[0];
  if (!row || row.email !== DEVELOPER_LOGIN_EMAIL) return null;
  return { email: row.email };
}

export async function requireDeveloper(token = "") {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  return { ok: true as const, email: session.email };
}
