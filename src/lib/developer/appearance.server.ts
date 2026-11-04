import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { projectRoot, projectUnavailableMessage } from "@/lib/developer/project-root.server";
import { invalidatePublicConfig } from "@/lib/developer/console.server";
import {
  emptyAppearance,
  parseAppearance,
  sanitizeAppearance,
  type AppearanceConfig,
  type ImageFit,
  type ImagePosition,
} from "@/lib/wedding/classic-maker";

const SLOTS = new Set(["landing/mobile", "landing/desktop", "wedding-bar/mobile", "wedding-bar/desktop", "classic-themes"]);
const MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function sessionOrError(token: string) {
  return requireDeveloper(token).catch(() => ({ ok: false as const, error: "Developer session required." }));
}

export async function readStoredAppearance(): Promise<AppearanceConfig> {
  try {
    const sql = await getSql();
    const rows = await sql<{ value: string }>`select value from developer_config where key = ${"wcAppearance"} limit 1`;
    if (rows[0]?.value) return parseAppearance(rows[0].value);
  } catch {
    /* The bundled file remains the fallback. */
  }
  const root = projectRoot();
  if (!root) return emptyAppearance();
  try {
    const text = await readFile(join(root, "public", "assets", "developer", "appearance.json"), "utf8");
    return parseAppearance(text);
  } catch {
    return emptyAppearance();
  }
}

async function writeConfig(email: string, next: AppearanceConfig) {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  const clean = sanitizeAppearance(stamped);
  const json = JSON.stringify(clean, null, 2);
  const root = projectRoot();
  let bundled = false;
  if (root) {
    const file = join(root, "public", "assets", "developer", "appearance.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, json);
    bundled = true;
  }
  try {
    const sql = await getSql();
    await sql`
      insert into developer_config (key, value, updated_by, updated_at)
      values (${"wcAppearance"}, ${json}, ${email}, now())
      on conflict (key) do update set value = ${json}, updated_by = ${email}, updated_at = now()
    `;
  } catch {
    if (!bundled) throw new Error("The appearance settings could not be saved.");
  }
  invalidatePublicConfig();
  return { config: clean, bundled };
}

function magicOk(mime: string, bytes: Buffer) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50;
  if (mime === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

export async function integrateDeveloperImage(token: string, input: { slot?: unknown; mime?: unknown; data?: unknown }) {
  const session = await sessionOrError(token);
  if (!session.ok) return { ok: false as const, error: session.error, bundled: false as const };
  const slot = typeof input.slot === "string" ? input.slot : "";
  if (!SLOTS.has(slot)) return { ok: false as const, error: "That image slot is not available.", bundled: false as const };
  const mime = input.mime === "image/jpg" ? "image/jpeg" : typeof input.mime === "string" ? input.mime : "";
  if (!MIME.has(mime)) return { ok: false as const, error: "Use a JPEG, PNG, or WebP image.", bundled: false as const };
  const raw = typeof input.data === "string" ? input.data : "";
  const payload = (raw.includes(",") ? raw.split(",").pop() || "" : raw).replace(/\s/g, "");
  if (payload.length < 32 || payload.length > 1_700_000 || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    return { ok: false as const, error: "That image is empty or larger than the limit.", bundled: false as const };
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length < 32 || bytes.length > 1_200_000 || !magicOk(mime, bytes)) {
    return { ok: false as const, error: "That file is not a valid image, or it is too large.", bundled: false as const };
  }
  const root = projectRoot();
  if (!root) {
    return {
      ok: false as const,
      bundled: false as const,
      error: projectUnavailableMessage(),
      download: {
        filename: `${slot.replace("/", "-")}-${randomBytes(3).toString("hex")}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`,
        base64: payload,
        note: "This server cannot write source files. The image was not saved over the working asset.",
      },
    };
  }
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const name = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}.${ext}`;
  const rel = `/assets/developer/${slot}/${name}`;
  const abs = resolve(root, "public", rel.slice(1));
  const rootAssets = resolve(root, "public", "assets", "developer");
  if (!abs.startsWith(rootAssets)) return { ok: false as const, error: "That image path was rejected.", bundled: false as const };
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  const check = await readFile(abs);
  if (check.length !== bytes.length) {
    return { ok: false as const, error: "The image file could not be verified. The previous asset was left in place.", bundled: false as const };
  }
  const manifestPath = join(root, "public", "assets", "developer", "manifest.json");
  let manifest = { assets: [] as { path: string; slot: string; bytes: number }[] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.assets)) manifest.assets = [];
  } catch {
    manifest = { assets: [] };
  }
  manifest.assets.push({ path: rel, slot, bytes: bytes.length });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { ok: true as const, bundled: true as const, path: rel, bytes: bytes.length, status: "Saved to project assets." as const };
}

function imageChoice(value: unknown, fallback: AppearanceConfig["mobileLanding"]) {
  if (value === null) return null;
  if (!value || typeof value !== "object") return fallback;
  const raw = value as { src?: unknown; fit?: unknown; position?: unknown; bundled?: unknown };
  const src = typeof raw.src === "string" ? raw.src.trim() : "";
  const allowed = src.startsWith("/assets/developer/") || src.startsWith("/card-themes/") || src.startsWith("/library/") || src.startsWith("/media/") || src.startsWith("/covers/");
  if (!src || src.includes("..") || !allowed) return fallback;
  const fit: ImageFit = raw.fit === "contain" ? "contain" : "cover";
  const position: ImagePosition = raw.position === "top" || raw.position === "bottom" || raw.position === "left" || raw.position === "right" ? raw.position : "center";
  return { src: src.slice(0, 240), fit, position, bundled: raw.bundled === true };
}

export async function saveAppearance(token: string, input: unknown) {
  const session = await sessionOrError(token);
  if (!session.ok) return { ok: false as const, error: session.error };
  const current = await readStoredAppearance();
  const body = input && typeof input === "object" ? input as {
    mobileLanding?: unknown;
    landingBackground?: unknown;
    ceremonyBackground?: unknown;
    themes?: unknown;
  } : {};
  const next = sanitizeAppearance({
    updatedAt: new Date().toISOString(),
    mobileLanding: "mobileLanding" in body ? imageChoice(body.mobileLanding, current.mobileLanding) : current.mobileLanding,
    landingBackground: "landingBackground" in body ? imageChoice(body.landingBackground, current.landingBackground) : current.landingBackground,
    ceremonyBackground: "ceremonyBackground" in body ? imageChoice(body.ceremonyBackground, current.ceremonyBackground) : current.ceremonyBackground,
    themes: "themes" in body ? body.themes : current.themes,
  });
  if ("themes" in body && Array.isArray(body.themes) && next.themes.length !== body.themes.filter((item) => item && typeof item === "object").length) {
    const dropped = body.themes.length - next.themes.length;
    if (dropped > 0 && next.themes.length === 0 && body.themes.length > 0) {
      return { ok: false as const, error: "That theme was not saved. Built-in themes cannot be overwritten." };
    }
  }
  try {
    const saved = await writeConfig(session.email, next);
    return { ok: true as const, appearance: saved.config, bundled: saved.bundled, status: saved.bundled ? "Saved to project assets." : "Saved for this server. The source files were not changed." };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "The appearance settings could not be saved." };
  }
}
