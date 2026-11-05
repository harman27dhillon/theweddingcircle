import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSql, type Sql } from "@/lib/db";
import { parseAppearance } from "@/lib/wedding/classic-maker";
import { isWorkspacePreview } from "@/lib/env.server";
import { googleConfigured } from "@/lib/google/photos.server";
import { developerSession } from "@/lib/developer/gate.server";
import { canonicalCardRatio } from "@/lib/wedding/card-ratio";
import { projectRoot } from "@/lib/developer/project-root.server";
import { openaiConfigured, openaiModel } from "@/lib/developer/openai.server";
import type { ProposalHunk } from "@/lib/developer/types";

function projectDir() {
  return projectRoot() ?? process.cwd();
}
const HASH = "3aa2ee3c2f232c1dd47a2246402f34c2190663dcf5f57572f034abd66c796717";

const FLAG_KEYS = ["photoUploads", "googlePhotos", "weddingCountdown", "premiumThemes"] as const;
const FLAG_LABELS: Record<(typeof FLAG_KEYS)[number], string> = {
  photoUploads: "Photo uploads",
  googlePhotos: "Retired Drive switch. It does not store wedding media.",
  weddingCountdown: "Wedding countdown",
  premiumThemes: "Premium themes",
};

type Hunk = ProposalHunk;

const DEFAULT_FLAGS: Record<(typeof FLAG_KEYS)[number], boolean> = {
  photoUploads: true,
  googlePhotos: true,
  weddingCountdown: false,
  premiumThemes: true,
};

function nid() {
  return randomBytes(16).toString("hex");
}

async function ensureDefaults(sql: Sql) {
  for (const key of FLAG_KEYS) {
    await sql`insert into developer_flags (key, enabled) values (${key}, ${DEFAULT_FLAGS[key]}) on conflict (key) do nothing`;
  }
  const config: Record<string, string> = {
    circleFeeLabel: "₹499",
    circleFeePaise: "49900",
    maxPhotos: "50",
    maxVideos: "5",
    appAnnouncement: "",
    cardRatioLanding: "original",
    cardRatioLandingDesktop: "original",
    cardRatioPinned: "original",
    cardPinnedFull: "off",
  };
  for (const [key, value] of Object.entries(config)) {
    await sql`insert into developer_config (key, value) values (${key}, ${value}) on conflict (key) do nothing`;
  }
}

function enabledOf(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

let defaultsReady: Promise<void> | null = null;

function ensureDefaultsOnce() {
  defaultsReady ??= (async () => {
    const sql = await getSql();
    await ensureDefaults(sql);
  })().catch((error: unknown) => {
    defaultsReady = null;
    throw error;
  });
  return defaultsReady;
}

let publicConfigCache: { at: number; value: Awaited<ReturnType<typeof readPublicConfig>> } | null = null;

export async function publicConfig() {
  if (publicConfigCache && Date.now() - publicConfigCache.at < 4000) return publicConfigCache.value;
  const value = await readPublicConfig();
  publicConfigCache = { at: Date.now(), value };
  return value;
}

export function invalidatePublicConfig() {
  publicConfigCache = null;
}

async function readPublicConfig() {
  const sql = await getSql();
  await ensureDefaultsOnce();
  const [flags, config] = await Promise.all([
    sql<{ key: string; enabled: unknown }>`select key, enabled from developer_flags`,
    sql<{ key: string; value: string }>`select key, value from developer_config`,
  ]);
  const map = Object.fromEntries(config.map((row) => [row.key, row.value]));
  const flagMap = { ...DEFAULT_FLAGS } as Record<string, boolean>;
  for (const row of flags) flagMap[row.key] = enabledOf(row.enabled);
  const paise = Number(map.circleFeePaise);
  const photos = Number(map.maxPhotos);
  const videos = Number(map.maxVideos);
  return {
    flags: flagMap,
    feeLabel: map.circleFeeLabel || "₹499",
    feePaise: Number.isFinite(paise) && paise > 0 ? paise : 49900,
    maxPhotos: Number.isFinite(photos) && photos > 0 ? Math.min(50, photos) : 50,
    maxVideos: Number.isFinite(videos) && videos > 0 ? Math.min(5, videos) : 5,
    announcement: (map.appAnnouncement || "").slice(0, 280),
    cards: {
      landing: canonicalCardRatio(map.cardRatioLanding) ?? "original",
      landingDesktop: canonicalCardRatio(map.cardRatioLandingDesktop) ?? "original",
      pinned: canonicalCardRatio(map.cardRatioPinned) ?? "original",
      pinnedFull: map.cardPinnedFull === "on",
      pinnedBar: canonicalCardRatio(map.cardRatioPinnedBar) ?? "original",
    },
    sample: await sampleShowcase(sql, map),
    appearance: parseAppearance(map.wcAppearance),
  };
}

async function sampleShowcase(sql: Awaited<ReturnType<typeof getSql>>, map: Record<string, string>) {
  const cover = sampleCoverOf(map.sampleCover || "");
  let src = "";
  if (cover.startsWith("/library/")) {
    const id = cover.slice("/library/".length).split("?")[0];
    if (id) {
      try {
        const rows = await sql<{ updated_at: unknown }>`select updated_at from library_assets where asset_id = ${id} limit 1`;
        const stamp = rows[0]?.updated_at ? new Date(rows[0].updated_at as string | number).getTime() : 0;
        if (stamp) src = `/api/library/file/${encodeURIComponent(id)}?v=${stamp}`;
        else src = cover;
      } catch {
        src = "";
      }
    }
  } else if (cover.startsWith("/media/")) {
    src = cover;
  } else if (cover) {
    src = cover;
  }
  return {
    bride: (map.sampleBride || "").slice(0, 80),
    groom: (map.sampleGroom || "").slice(0, 80),
    date: (map.sampleDate || "").slice(0, 20),
    city: (map.sampleCity || "").slice(0, 80),
    place: (map.samplePlace || "").slice(0, 80),
    cover,
    src,
  };
}

async function audit(email: string, command: string, interpretation: string, level: string, action: string, result: string, files = "", error = "") {
  const sql = await getSql();
  await sql`insert into developer_audit (id, email, command, interpretation, level, action, result, files, error) values (${nid()}, ${email}, ${command.slice(0, 2000)}, ${interpretation.slice(0, 4000)}, ${level}, ${action.slice(0, 500)}, ${result.slice(0, 500)}, ${files.slice(0, 2000)}, ${error.slice(0, 2000)})`;
}

async function recordError(source: string, message: string, detail = "") {
  const sql = await getSql();
  const clean = message.slice(0, 500);
  const recent = await sql<{ id: string }>`select id from developer_errors where source = ${source} and message = ${clean} and created_at > now() - interval '1 hour' limit 1`;
  if (recent.length) return;
  await sql`insert into developer_errors (id, source, message, detail) values (${nid()}, ${source.slice(0, 40)}, ${clean}, ${detail.slice(0, 2000)})`;
}

export async function noteAppError(source: string, message: string) {
  if (!message.trim()) return { ok: true as const };
  await recordError(source || "app", message.trim());
  return { ok: true as const };
}

function workspaceReady() {
  return projectRoot() !== null;
}

function integrationStatus() {
  return {
    ai: openaiConfigured(),
    github: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY),
    deploy: Boolean(process.env.VERCEL_TOKEN),
    database: true,
    workspace: workspaceReady(),
  };
}

async function gitHead() {
  if (!existsSync(join(projectDir(), ".git"))) return "";
  const git = await run("git", ["rev-parse", "--short", "HEAD"], 4000);
  if (git.code !== 0) return "";
  return git.output.trim().split("\n").pop() || "";
}

export async function overview(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  await ensureDefaults(sql);
  let database: "ok" | "down" = "ok";
  try {
    await sql`select 1 as ok`;
  } catch {
    database = "down";
  }
  let circleSql = sql;
  try {
    const { weddingDataSql } = await import("@/lib/developer/core-route.server");
    circleSql = await weddingDataSql();
  } catch {
    circleSql = sql;
  }
  const circles = await circleSql<{ n: number; bytes: number }>`select count(*)::int as n, coalesce(sum(octet_length(payload::text)), 0)::int as bytes from circles`;
  const media = await sql<{ n: number }>`select count(*)::int as n from google_media`;
  const connections = await sql<{ n: number }>`select count(*)::int as n from google_connections`;
  const audits = await sql<{ command: string; result: string; level: string; created_at: string }>`select command, result, level, created_at from developer_audit order by created_at desc limit 8`;
  const errors = await sql<{ source: string; message: string; created_at: string }>`select source, message, created_at from developer_errors order by created_at desc limit 6`;
  const runtime = await publicConfig();
  const google = await googleConfigured().catch(() => false);
  const commit = await gitHead();
  const integrations = integrationStatus();
  return {
    ok: true as const,
    email: session.email,
    application: {
      name: "Wedding Circle",
      version: "1.168.60",
      environment: isWorkspacePreview() ? "Development" : "Production",
      status: database === "ok" ? "Running" : "Database unavailable",
      commit: commit || "No Git repository is connected",
      workspace: integrations.workspace ? "Project files can be edited from this session" : "Project files are not writable here",
    },
    usage: {
      publishedWeddings: Number(circles[0]?.n ?? 0),
      databaseBytes: Number(circles[0]?.bytes ?? 0),
      googleConnections: Number(connections[0]?.n ?? 0),
      storedMediaItems: Number(media[0]?.n ?? 0),
      profiles: "Wedding profiles stay on each phone. This server does not have a central user count.",
    },
    system: {
      api: "ok" as const,
      database,
      authentication: "Developer password is checked on the server.",
      storage: database,
      google: google ? "configured" : "not configured",
      ai: integrations.ai ? `available (${openaiModel()})` : "not configured",
      github: integrations.github ? "connected" : "not connected",
      deploy: integrations.deploy ? "connected" : "not connected",
    },
    runtime,
    activity: audits,
    errors,
  };
}

const BANNED: [RegExp, string][] = [
  [/drop\s+database/i, "DROP DATABASE"],
  [/delete\s+all\s+users/i, "DELETE ALL USERS"],
  [/delete\s+all\s+weddings/i, "DELETE ALL WEDDINGS"],
  [/truncate\s+/i, "TRUNCATE"],
];

function run(command: string, args: string[], timeout: number) {
  return new Promise<{ code: number; output: string }>((resolvePromise) => {
    const child = spawn(command, args, { cwd: projectDir() });
    let output = "";
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-6000);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise({ code: 124, output: `${output}\nTimed out.` });
    }, timeout);
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

function sampleCoverOf(value: string) {
  const cover = value.trim();
  if (!cover) return "";
  if (cover.startsWith("/media/") || cover.startsWith("/library/") || cover.startsWith("theme:")) return cover.slice(0, 240);
  if (cover.startsWith("data:image/jpeg") || cover.startsWith("data:image/png") || cover.startsWith("data:image/webp")) {
    return cover.length <= 500_000 ? cover : "";
  }
  return "";
}

export async function setSampleShowcase(
  token: string,
  input: { bride: string; groom: string; date: string; city: string; place: string; cover: string },
) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const bride = input.bride.trim().slice(0, 80);
  const groom = input.groom.trim().slice(0, 80);
  if (bride.length < 2 || groom.length < 2) return { ok: false as const, error: "Add the bride and groom names." };
  const cover = sampleCoverOf(input.cover);
  if (input.cover.trim() && !cover) return { ok: false as const, error: "Use a smaller JPEG, PNG, or WebP for the sample cover." };
  const date = input.date.trim().slice(0, 20);
  const city = input.city.trim().slice(0, 80);
  const place = input.place.trim().slice(0, 80);
  const sql = await getSql();
  await ensureDefaults(sql);
  const rows: Record<string, string> = {
    sampleBride: bride,
    sampleGroom: groom,
    sampleDate: date,
    sampleCity: city,
    samplePlace: place,
    sampleCover: cover,
  };
  for (const [key, value] of Object.entries(rows)) {
    await sql`insert into developer_config (key, value, updated_by, updated_at) values (${key}, ${value}, ${session.email}, now()) on conflict (key) do update set value = ${value}, updated_by = ${session.email}, updated_at = now()`;
  }
  await audit(session.email, "Update sample wedding", `${bride} & ${groom}`, "green", "config", "applied");
  invalidatePublicConfig();
  return { ok: true as const, ...(await publicConfig()) };
}

const MEDIA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_OK = /^[a-z0-9-]{3,80}$/;
const COVER_FALLBACK = "/media/demo-hall.svg";

export async function connections() {
  const commit = await gitHead();
  return {
    github: process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY ? "connected" : "missing",
    repository: process.env.GITHUB_REPOSITORY || "",
    deploy: process.env.VERCEL_TOKEN ? "connected" : "missing",
    commit: commit || "",
    ai: openaiConfigured() ? "available" : "missing",
  };
}
