import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { assertSameSiteRequest } from "@/lib/auth/isolation.server";
import { serverEnvironment } from "@/lib/env.server";

const lifetime = 3600;
let failures = 0;
let windowEnds = 0;

async function settings() {
  const runtime = await serverEnvironment();
  const email = runtime.DEVELOPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = runtime.DEVELOPER_ADMIN_PASSWORD;
  const secret = runtime.DEVELOPER_SESSION_SECRET?.trim();
  return email && password && password.length >= 16 && secret && secret.length >= 32 ? { email, password, secret } : null;
}

function equal(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function signature(payload: string, config: NonNullable<Awaited<ReturnType<typeof settings>>>) {
  return createHmac("sha256", config.secret).update(JSON.stringify(["developer-control", config.email, config.password, payload])).digest("hex");
}

function cookieOptions() {
  const secure = !import.meta.env.DEV || new URL(getRequest().url).protocol === "https:";
  return { name: secure ? "__Host-wc_developer" : "wc_developer_local", secure };
}

export async function controlSession() {
  assertSameSiteRequest();
  const config = await settings();
  const token = getCookie(cookieOptions().name) || "";
  const match = /^(\d{13}\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  const email = config && match && Number(match[1].split(".")[0]) > Date.now() && equal(match[2], signature(match[1], config))
    ? config.email : null;
  return { configured: Boolean(config), email };
}

export async function controlSignIn(email: string, password: string) {
  assertSameSiteRequest();
  const config = await settings();
  if (!config) return { ok: false as const, message: "Developer sign-in needs its three server secrets. Set them on the Worker before opening this page." };
  const now = Date.now();
  if (now >= windowEnds) {
    failures = 0;
    windowEnds = now + 60_000;
  }
  if (failures >= 12) return { ok: false as const, message: "Too many attempts. Wait a minute and try again." };
  const passwordMatches = equal(password, config.password);
  if (!equal(email.trim().toLowerCase(), config.email) || !passwordMatches) {
    failures++;
    return { ok: false as const, message: "That developer sign-in was not accepted." };
  }
  const payload = `${now + lifetime * 1000}.${randomBytes(16).toString("hex")}`;
  const { name, secure } = cookieOptions();
  setCookie(name, `${payload}.${signature(payload, config)}`, { secure, httpOnly: true, sameSite: "strict", path: "/", maxAge: lifetime });
  return { ok: true as const, message: "Developer Center unlocked." };
}

export function controlSignOut() {
  assertSameSiteRequest();
  const { name, secure } = cookieOptions();
  setCookie(name, "", { secure, httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export async function requireControlSession() {
  if (!(await controlSession()).email) throw new Error("Developer sign-in required.");
}
