import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { getSql, type Sql } from "@/lib/db";
import { parseAppearance } from "@/lib/wedding/classic-maker";
import { isWorkspacePreview } from "@/lib/env.server";
import { googleConfigured } from "@/lib/google/photos.server";
import { developerSession } from "@/lib/developer/gate.server";
import { canonicalCardRatio } from "@/lib/wedding/card-ratio";
import { projectRoot, projectUnavailableMessage } from "@/lib/developer/project-root.server";
import { openaiComplete, openaiConfigured, openaiModel } from "@/lib/developer/openai.server";
import type { ProposalHunk, ProposalView } from "@/lib/developer/types";

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

function safePath(input: string) {
  const clean = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\0")) return null;
  if (!clean.startsWith("src/") && !clean.startsWith("migrations/")) return null;
  const full = resolve(projectDir(), clean);
  const root = resolve(projectDir());
  if (full !== root && !full.startsWith(root + sep)) return null;
  return { clean, full };
}

function walk(dir: string, out: string[], depth: number) {
  if (depth > 5 || out.length > 280) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(full, out, depth + 1);
    else if (/\.(tsx?|css|sql)$/.test(name)) out.push(relative(projectDir(), full).split(sep).join("/"));
  }
}

function redact(text: string) {
  return text
    .replaceAll(HASH, "[redacted]")
    .replace(/(refresh_token|client_secret|clientSecret|api_key|passwordHash"\s*:\s*")[^"\n]+/gi, "$1[redacted]");
}

function readSource(rel: string) {
  const path = safePath(rel);
  if (!path || !existsSync(path.full)) return "";
  const info = statSync(path.full);
  if (!info.isFile() || info.size > 180_000) return "";
  return redact(readFileSync(path.full, "utf8")).slice(0, 14000);
}

function parseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a plan.");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function asHunks(value: unknown): Hunk[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as { path?: unknown; old?: unknown; new?: unknown };
      return {
        path: typeof row.path === "string" ? row.path : "",
        old: typeof row.old === "string" ? row.old : "",
        new: typeof row.new === "string" ? row.new : "",
      };
    })
    .filter((item) => item.path && item.new.length < 20000 && item.old.length < 20000)
    .slice(0, 6);
}

const BANNED: [RegExp, string][] = [
  [/drop\s+database/i, "DROP DATABASE"],
  [/delete\s+all\s+users/i, "DELETE ALL USERS"],
  [/delete\s+all\s+weddings/i, "DELETE ALL WEDDINGS"],
  [/truncate\s+/i, "TRUNCATE"],
];

function bannedCommand(command: string) {
  return BANNED.find(([pattern]) => pattern.test(command))?.[1] ?? "";
}

function directAction(command: string): { level: "green"; kind: "flag" | "config"; summary: string; apply: (email: string) => Promise<void> } | null {
  const flag = command.match(/\b(turn|switch|set)\s+(on|off|enable|disable)\s+(photo uploads|google photos|google drive|wedding countdown|premium themes)\b/i);
  if (flag) {
    const on = flag[2] === "on" || flag[2] === "enable";
    const names = {
      "photo uploads": "photoUploads",
      "google photos": "googlePhotos",
      "google drive": "googlePhotos",
      "wedding countdown": "weddingCountdown",
      "premium themes": "premiumThemes",
    } as const;
    const phrase = flag[3].toLowerCase() as keyof typeof names;
    const key = names[phrase];
    if (!key) return null;
    return {
      level: "green",
      kind: "flag",
      summary: `${FLAG_LABELS[key]} is now ${on ? "on" : "off"}.`,
      apply: async (email) => {
        const sql = await getSql();
        await ensureDefaults(sql);
        await sql`update developer_flags set enabled = ${on}, updated_by = ${email}, updated_at = now() where key = ${key}`;
        invalidatePublicConfig();
      },
    };
  }
  const fee = command.match(/\b(?:change|set)\s+(?:the\s+)?(?:wedding\s+)?(?:creation\s+)?fee\s+to\s+₹?\s*(\d{1,6})\b/i);
  if (fee) {
    const rupees = Number(fee[1]);
    const label = `₹${rupees}`;
    const paise = String(rupees * 100);
    return {
      level: "green",
      kind: "config",
      summary: `The wedding creation fee is now ${label}. Payment is still a preview and does not charge a card.`,
      apply: async (email) => {
        const sql = await getSql();
        await ensureDefaults(sql);
        await sql`update developer_config set value = ${label}, updated_by = ${email}, updated_at = now() where key = ${"circleFeeLabel"}`;
        await sql`update developer_config set value = ${paise}, updated_by = ${email}, updated_at = now() where key = ${"circleFeePaise"}`;
        invalidatePublicConfig();
      },
    };
  }
  return null;
}

async function saveProposal(email: string, command: string, view: Omit<ProposalView, "id" | "status" | "validation" | "needsConfirmation">) {
  const sql = await getSql();
  const id = nid();
  await sql`insert into developer_proposals (id, email, command, level, kind, summary, reason, side_effects, risk, patch, status) values (${id}, ${email}, ${command.slice(0, 2000)}, ${view.level}, ${view.kind}, ${view.summary.slice(0, 4000)}, ${view.reason.slice(0, 4000)}, ${view.sideEffects.slice(0, 2000)}, ${view.risk.slice(0, 40)}, ${JSON.stringify(view.hunks)}::jsonb, ${"pending"})`;
  return id;
}

function viewFromRow(row: {
  id: string;
  command: string;
  level: string;
  kind: string;
  summary: string;
  reason: string;
  side_effects: string;
  risk: string;
  patch: unknown;
  status: string;
  validation: string;
}): ProposalView {
  const level = row.level === "red" || row.level === "yellow" || row.level === "green" ? row.level : "yellow";
  return {
    id: row.id,
    command: row.command,
    level,
    kind: row.kind,
    summary: row.summary,
    reason: row.reason,
    sideEffects: row.side_effects,
    risk: row.risk,
    hunks: asHunks(typeof row.patch === "string" ? JSON.parse(row.patch) : row.patch),
    status: row.status,
    validation: row.validation,
    needsConfirmation: level === "red",
  };
}

export async function runCommand(token: string, command: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const text = command.trim();
  if (text.length < 3) return { ok: false as const, error: "Write a fuller command." };
  if (text.length > 2000) return { ok: false as const, error: "That command is too long." };
  const banned = bannedCommand(text);
  if (banned) {
    await audit(session.email, text, `Refused ${banned}.`, "red", "refused", "refused", "", "This console will not run that operation.");
    return {
      ok: true as const,
      proposal: {
        id: "",
        command: text,
        level: "red" as const,
        kind: "refused",
        summary: `Refused. This console will not run ${banned}, even with a confirmation.`,
        reason: "That operation cannot be undone and is blocked.",
        sideEffects: "Nothing was changed.",
        risk: "High",
        hunks: [],
        status: "refused",
        validation: "",
        needsConfirmation: false,
      },
    };
  }
  const direct = directAction(text);
  if (direct) {
    await direct.apply(session.email);
    await audit(session.email, text, direct.summary, "green", direct.kind, "applied");
    return {
      ok: true as const,
      proposal: {
        id: "",
        command: text,
        level: "green" as const,
        kind: direct.kind,
        summary: direct.summary,
        reason: "This is an application setting, not a source-code change.",
        sideEffects: "Open pages pick this up the next time they load.",
        risk: "Low",
        hunks: [],
        status: "applied",
        validation: "No build was required.",
        needsConfirmation: false,
      },
    };
  }
  if (!openaiConfigured()) {
    return { ok: false as const, error: "OpenAI is not configured. Set the server variable OPENAI_API_KEY. Settings such as the fee and feature flags still work from Features." };
  }
  const files: string[] = [];
  walk(join(projectDir(), "src"), files, 0);
  walk(join(projectDir(), "migrations"), files, 0);
  const plan = await openaiComplete(
    [
      {
        role: "system",
        content:
          "You are the private engineer for Wedding Circle, a TanStack Start React app. Reply with JSON only. Choose up to 5 existing files to inspect. Do not invent paths. Keys: files (string[]), intent (string).",
      },
      { role: "user", content: `Command:\n${text}\n\nFiles:\n${files.slice(0, 280).join("\n")}` },
    ],
    400,
  );
  if (!plan.ok) return plan;
  let chosen: string[] = [];
  let intent = text;
  try {
    const parsed = parseJson(plan.text);
    chosen = Array.isArray(parsed.files) ? parsed.files.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
    if (typeof parsed.intent === "string") intent = parsed.intent;
  } catch {
    chosen = [];
  }
  const context = chosen
    .map((file) => {
      const body = readSource(file);
      return body ? `FILE ${file}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 48000);
  const draft = await openaiComplete(
    [
      {
        role: "system",
        content:
          "Reply with JSON only. You may propose a code change or answer without editing. Do not change the developer password hash. Do not claim tests passed. Do not invent a Git commit. Schema: {\"kind\":\"code\"|\"answer\"|\"refuse\",\"summary\":\"\",\"reason\":\"\",\"sideEffects\":\"\",\"risk\":\"Low\"|\"Medium\"|\"High\",\"hunks\":[{\"path\":\"src/or/migrations\",\"old\":\"exact existing excerpt or empty to create a file\",\"new\":\"replacement\"}]}. For kind answer or refuse, hunks must be []. Feature flags already exist: photoUploads, googlePhotos, weddingCountdown, premiumThemes. Fee config keys are circleFeeLabel and circleFeePaise. Prefer those for simple switches instead of rewriting pages. Keep hunks small.",
      },
      { role: "user", content: `Command:\n${text}\n\nIntent:\n${intent}\n\n${context || "No file was readable."}` },
    ],
    1800,
  );
  if (!draft.ok) return draft;
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJson(draft.text);
  } catch (error) {
    await recordError("command", error instanceof Error ? error.message : "Bad plan");
    return { ok: false as const, error: "The model did not return a usable plan. No files were changed." };
  }
  const kind = parsed.kind === "code" || parsed.kind === "answer" || parsed.kind === "refuse" ? parsed.kind : "answer";
  const hunks = kind === "code" ? asHunks(parsed.hunks) : [];
  const level: ProposalView["level"] = kind === "code" ? "yellow" : "green";
  const summary = typeof parsed.summary === "string" ? parsed.summary : "No summary was returned.";
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";
  const sideEffects = typeof parsed.sideEffects === "string" ? parsed.sideEffects : "";
  const risk = parsed.risk === "High" || parsed.risk === "Medium" || parsed.risk === "Low" ? parsed.risk : kind === "code" ? "Medium" : "Low";
  if (kind === "refuse" || (kind === "code" && hunks.length === 0)) {
    const proposal: ProposalView = {
      id: "",
      command: text,
      level: "green",
      kind: "answer",
      summary: summary || "No code change was proposed.",
      reason,
      sideEffects: sideEffects || "Nothing was changed.",
      risk,
      hunks: [],
      status: "answered",
      validation: "",
      needsConfirmation: false,
    };
    await audit(session.email, text, summary, "green", "answer", "answered");
    return { ok: true as const, proposal };
  }
  if (kind === "answer") {
    await audit(session.email, text, summary, "green", "answer", "answered");
    return {
      ok: true as const,
      proposal: {
        id: "",
        command: text,
        level: "green" as const,
        kind: "answer",
        summary,
        reason,
        sideEffects: sideEffects || "Nothing was changed.",
        risk,
        hunks: [],
        status: "answered",
        validation: "",
        needsConfirmation: false,
      },
    };
  }
  const id = await saveProposal(session.email, text, { command: text, level, kind, summary, reason, sideEffects, risk, hunks });
  await audit(session.email, text, summary, level, "proposed", "pending", hunks.map((item) => item.path).join(", "));
  return {
    ok: true as const,
    proposal: { id, command: text, level, kind, summary, reason, sideEffects, risk, hunks, status: "pending", validation: "", needsConfirmation: false },
  };
}

export async function reviseProposal(token: string, proposalId: string, note: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<Parameters<typeof viewFromRow>[0]>`select * from developer_proposals where id = ${proposalId} and email = ${session.email} limit 1`;
  const current = rows[0] ? viewFromRow(rows[0]) : null;
  if (!current || current.status !== "pending") return { ok: false as const, error: "That proposal is not waiting for review." };
  const follow = note.trim();
  if (follow.length < 2) return { ok: false as const, error: "Add the follow-up." };
  const draft = await openaiComplete(
    [
      {
        role: "system",
        content:
          "Revise the existing proposal. Reply with JSON only using the same schema: kind, summary, reason, sideEffects, risk, hunks. Do not start an unrelated change. Do not change the developer password hash.",
      },
      {
        role: "user",
        content: `Original command:\n${current.command}\n\nPrevious summary:\n${current.summary}\n\nPrevious hunks:\n${JSON.stringify(current.hunks).slice(0, 12000)}\n\nFollow-up:\n${follow}`,
      },
    ],
    1800,
  );
  if (!draft.ok) return draft;
  try {
    const parsed = parseJson(draft.text);
    const hunks = parsed.kind === "answer" || parsed.kind === "refuse" ? [] : asHunks(parsed.hunks);
    const summary = typeof parsed.summary === "string" ? parsed.summary : current.summary;
    const reason = typeof parsed.reason === "string" ? parsed.reason : current.reason;
    const sideEffects = typeof parsed.sideEffects === "string" ? parsed.sideEffects : current.sideEffects;
    const risk = parsed.risk === "High" || parsed.risk === "Medium" || parsed.risk === "Low" ? parsed.risk : current.risk;
    const kind = hunks.length ? "code" : "answer";
    await sql`update developer_proposals set summary = ${summary}, reason = ${reason}, side_effects = ${sideEffects}, risk = ${risk}, kind = ${kind}, patch = ${JSON.stringify(hunks)}::jsonb where id = ${proposalId}`;
    await audit(session.email, current.command, `Revised: ${follow}`, "yellow", "revised", "pending", hunks.map((item) => item.path).join(", "));
    return {
      ok: true as const,
      proposal: { ...current, kind, summary, reason, sideEffects, risk, hunks, status: "pending" as const },
    };
  } catch {
    return { ok: false as const, error: "The revision was not usable. The previous proposal is unchanged." };
  }
}

function applyHunks(hunks: Hunk[]) {
  const planned: { clean: string; full: string; before: string; next: string }[] = [];
  const buffers = new Map<string, { full: string; before: string; next: string }>();
  for (const hunk of hunks) {
    const path = safePath(hunk.path);
    if (!path) return { ok: false as const, error: `Refused path ${hunk.path}. Only source and migration files can change.` };
    if (hunk.new.includes("[redacted]") || hunk.old.includes(HASH) || hunk.new.includes(HASH)) {
      return { ok: false as const, error: "A change tried to touch a secret or the developer password. It was not applied." };
    }
    const existing = buffers.get(path.clean);
    const exists = existing ? true : existsSync(path.full);
    const before = existing ? existing.next : exists ? readFileSync(path.full, "utf8") : "";
    let next = before;
    if (!hunk.old) {
      if (exists) return { ok: false as const, error: `${path.clean} already exists. Nothing was written.` };
      next = hunk.new;
    } else {
      if (!exists) return { ok: false as const, error: `${path.clean} was not found. Nothing was written.` };
      const at = before.indexOf(hunk.old);
      if (at < 0 || before.indexOf(hunk.old, at + 1) >= 0) {
        return { ok: false as const, error: `The excerpt in ${path.clean} was not unique. Nothing was written.` };
      }
      next = before.slice(0, at) + hunk.new + before.slice(at + hunk.old.length);
    }
    const original = existing?.before ?? before;
    if (original.includes(HASH) && !next.includes(HASH)) {
      return { ok: false as const, error: "The developer password cannot be changed from a command." };
    }
    buffers.set(path.clean, { full: path.full, before: original, next });
    if (!planned.some((item) => item.clean === path.clean)) planned.push({ clean: path.clean, full: path.full, before: original, next });
  }
  for (const file of planned) {
    const latest = buffers.get(file.clean);
    if (!latest) continue;
    writeFileSync(file.full, latest.next);
    file.before = latest.before;
  }
  return { ok: true as const, written: planned.map((file) => ({ path: file.clean, before: buffers.get(file.clean)?.before ?? file.before })) };
}

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

async function validate() {
  const typecheck = await run("npx", ["tsc", "--noEmit", "--pretty", "false"], 90000);
  const tests = typecheck.code === 124 ? { code: 125, output: "Skipped because type check timed out." } : await run("npm", ["test"], 90000);
  const lines = [
    `Type check: ${typecheck.code === 0 ? "PASS" : "FAIL"}`,
    typecheck.code === 0 ? "" : typecheck.output.trim(),
    `Tests: ${tests.code === 0 ? "PASS" : "FAIL"}`,
    tests.code === 0 ? "" : tests.output.trim(),
    "Lint: not run for the whole project in this step.",
    "Build: not run in this step. Use Deployments to run a real build. It is not marked as passed.",
  ];
  return { ok: typecheck.code === 0 && tests.code === 0, text: lines.filter((line) => line !== undefined).join("\n").slice(0, 5000) };
}

export async function approveProposal(token: string, proposalId: string, confirmMigration: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!workspaceReady()) {
    return {
      ok: false as const,
      error: `${projectUnavailableMessage()} GitHub is not connected, so this change was not applied and was not deployed.`,
    };
  }
  const sql = await getSql();
  const rows = await sql<Parameters<typeof viewFromRow>[0]>`select * from developer_proposals where id = ${proposalId} and status = ${"pending"} limit 1`;
  const proposal = rows[0] ? viewFromRow(rows[0]) : null;
  if (!proposal) return { ok: false as const, error: "That proposal is not waiting." };
  if (proposal.hunks.some((item) => item.path.startsWith("migrations/")) && !confirmMigration) {
    return { ok: false as const, error: "This proposal changes a migration. Confirm the migration before it is written." };
  }
  const applied = applyHunks(proposal.hunks);
  if (!applied.ok) {
    await audit(session.email, proposal.command, proposal.summary, "yellow", "apply-failed", "failed", proposal.hunks.map((item) => item.path).join(", "), applied.error);
    return applied;
  }
  for (const file of applied.written) {
    await sql`insert into developer_revisions (id, proposal_id, path, before_text) values (${nid()}, ${proposal.id}, ${file.path}, ${file.before})`;
  }
  const validation = await validate();
  await sql`update developer_proposals set status = ${"applied"}, validation = ${validation.text} where id = ${proposal.id}`;
  await audit(session.email, proposal.command, proposal.summary, "yellow", "applied", validation.ok ? "applied" : "applied-with-failed-checks", applied.written.map((item) => item.path).join(", "), validation.ok ? "" : "Checks failed");
  if (!validation.ok) await recordError("validation", "Checks failed after an approved change.", validation.text.slice(0, 500));
  return { ok: true as const, validation: validation.text, files: applied.written.map((item) => item.path), checksPassed: validation.ok };
}

export async function cancelProposal(token: string, proposalId: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  await sql`update developer_proposals set status = ${"cancelled"} where id = ${proposalId} and status = ${"pending"}`;
  await audit(session.email, proposalId, "Proposal cancelled.", "green", "cancel", "cancelled");
  return { ok: true as const };
}

export async function revertProposal(token: string, proposalId: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!workspaceReady()) return { ok: false as const, error: "Project files are not writable here, so this cannot be restored from the server." };
  const sql = await getSql();
  const files = await sql<{ path: string; before_text: string }>`select path, before_text from developer_revisions where proposal_id = ${proposalId}`;
  if (!files.length) return { ok: false as const, error: "There is no saved copy to restore." };
  for (const file of files) {
    const path = safePath(file.path);
    if (!path) continue;
    if (!file.before_text) continue;
    writeFileSync(path.full, file.before_text);
  }
  await sql`update developer_proposals set status = ${"reverted"} where id = ${proposalId}`;
  await audit(session.email, proposalId, "Restored the files from before that command.", "yellow", "revert", "reverted", files.map((item) => item.path).join(", "));
  return { ok: true as const, files: files.map((item) => item.path) };
}

export async function listProposals(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<Parameters<typeof viewFromRow>[0]>`select * from developer_proposals order by created_at desc limit 12`;
  return { ok: true as const, proposals: rows.map(viewFromRow) };
}

export async function listAudit(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<{
    email: string;
    command: string;
    interpretation: string;
    level: string;
    action: string;
    result: string;
    files: string;
    error: string;
    created_at: string;
  }>`select email, command, interpretation, level, action, result, files, error, created_at from developer_audit order by created_at desc limit 40`;
  return { ok: true as const, entries: rows };
}

export async function listErrors(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<{ id: string; source: string; message: string; detail: string; created_at: string }>`select id, source, message, detail, created_at from developer_errors order by created_at desc limit 40`;
  return { ok: true as const, errors: rows };
}

export async function analyzeError(token: string, errorId: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<{ message: string; detail: string; source: string }>`select message, detail, source from developer_errors where id = ${errorId} limit 1`;
  const item = rows[0];
  if (!item) return { ok: false as const, error: "That error was not found." };
  if (!openaiConfigured()) return { ok: false as const, error: "OpenAI is not configured. Set the server variable OPENAI_API_KEY. No files were changed." };
  const result = await openaiComplete(
    [
      {
        role: "system",
        content:
          "You diagnose Wedding Circle. Reply in plain text with CAUSE, AFFECTED FILES, PROPOSED FIX, and RISK (Low, Medium, or High). Do not claim you already changed code.",
      },
      { role: "user", content: `${item.source}\n${item.message}\n${item.detail}` },
    ],
    700,
  );
  if (!result.ok) return result;
  await audit(session.email, item.message, result.text.slice(0, 500), "green", "analyze", "answered");
  return { ok: true as const, analysis: result.text };
}

export async function setFlag(token: string, key: string, enabled: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!FLAG_KEYS.includes(key as (typeof FLAG_KEYS)[number])) return { ok: false as const, error: "Unknown feature." };
  const sql = await getSql();
  await ensureDefaults(sql);
  await sql`update developer_flags set enabled = ${enabled}, updated_by = ${session.email}, updated_at = now() where key = ${key}`;
  await audit(session.email, `${key} ${enabled ? "on" : "off"}`, "Feature flag updated.", "green", "flag", "applied", key);
  invalidatePublicConfig();
  return { ok: true as const, ...(await publicConfig()) };
}

export async function setAnnouncement(token: string, text: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const value = text.trim().slice(0, 280);
  const sql = await getSql();
  await ensureDefaults(sql);
  await sql`update developer_config set value = ${value}, updated_by = ${session.email}, updated_at = now() where key = ${"appAnnouncement"}`;
  await audit(session.email, "Update app announcement", value || "Cleared.", "green", "config", "applied");
  invalidatePublicConfig();
  return { ok: true as const, ...(await publicConfig()) };
}

export async function setCardDisplay(
  token: string,
  input: { landing: string; landingDesktop: string; pinned: string; pinnedFull: boolean; pinnedBar?: string },
) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const landing = canonicalCardRatio(input.landing);
  const landingDesktop = canonicalCardRatio(input.landingDesktop);
  const pinned = canonicalCardRatio(input.pinned);
  const pinnedBar = input.pinnedBar === undefined ? undefined : canonicalCardRatio(input.pinnedBar);
  if (!landing || !landingDesktop || !pinned || (input.pinnedBar !== undefined && !pinnedBar)) return { ok: false as const, error: "Choose a supported card ratio." };
  const pinnedFull = input.pinnedFull ? "on" : "off";
  const sql = await getSql();
  await ensureDefaults(sql);
  const previous = await sql<{ key: string; value: string }>`select key, value from developer_config where key in ('cardRatioLanding', 'cardRatioLandingDesktop', 'cardRatioPinned', 'cardPinnedFull', 'cardRatioPinnedBar')`;
  const before = Object.fromEntries(previous.map((row) => [row.key, row.value]));
  const next: Record<string, string> = {
    cardRatioLanding: landing,
    cardRatioLandingDesktop: landingDesktop,
    cardRatioPinned: pinned,
    cardPinnedFull: pinnedFull,
    ...(pinnedBar ? { cardRatioPinnedBar: pinnedBar } : {}),
  };
  try {
    for (const [key, value] of Object.entries(next)) {
      await sql`insert into developer_config (key, value, updated_by, updated_at) values (${key}, ${value}, ${session.email}, now()) on conflict (key) do update set value = ${value}, updated_by = ${session.email}, updated_at = now()`;
    }
  } catch {
    for (const [key, value] of Object.entries(before)) {
      await sql`insert into developer_config (key, value, updated_by, updated_at) values (${key}, ${value}, ${session.email}, now()) on conflict (key) do update set value = ${value}, updated_by = ${session.email}, updated_at = now()`;
    }
    invalidatePublicConfig();
    return { ok: false as const, error: "The card display could not be saved. The previous settings are still in use." };
  }
  invalidatePublicConfig();
  await audit(session.email, "Update wedding card display", `Mobile ${landing}. Desktop ${landingDesktop}. Pinned ${pinned}. Full screen ${pinnedFull}. Pinned bar ${pinnedBar || before.cardRatioPinnedBar || "original"}.`, "green", "config", "applied");
  return { ok: true as const, ...(await publicConfig()) };
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

export async function databaseReport(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const tables = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
  const counts: { table: string; rows: number }[] = [];
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table.table_name)) continue;
    const rows = await sql.query<{ n: number }>(`select count(*)::int as n from ${table.table_name}`);
    counts.push({ table: table.table_name, rows: Number(rows[0]?.n ?? 0) });
  }
  return {
    ok: true as const,
    source: process.env.DATABASE_URL ? "Postgres" : "Embedded Postgres",
    tables: counts,
    note: "There is no open SQL box. Schema changes go through a reviewed migration, then a second confirmation.",
  };
}

export async function weddingReport(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const sql = await weddingDataSql();
  const rows = await sql<{ slug: string; updated_at: string; payload: Record<string, unknown> }>`select slug, updated_at, payload from circles order by updated_at desc limit 40`;
  return {
    ok: true as const,
    weddings: rows.map((row) => {
      const payload = row.payload ?? {};
      const guests = Array.isArray(payload.guests) ? payload.guests.length : 0;
      const posts = Array.isArray(payload.posts) ? payload.posts.length : 0;
      return {
        slug: row.slug,
        updatedAt: row.updated_at,
        bride: typeof payload.bride === "string" ? payload.bride : "",
        groom: typeof payload.groom === "string" ? payload.groom : "",
        city: typeof payload.city === "string" ? payload.city : "",
        date: typeof payload.date === "string" ? payload.date : "",
        disabled: Boolean(payload.disabled),
        guests,
        posts,
      };
    }),
  };
}

export async function suspendWedding(token: string, slug: string, paused: boolean, confirm: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!confirm) return { ok: false as const, error: "Confirm before pausing or opening a wedding." };
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || slug === "lila-nico") return { ok: false as const, error: "That wedding cannot be changed here." };
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const sql = await weddingDataSql();
  const rows = await sql<{ slug: string }>`select slug from circles where slug = ${slug} limit 1`;
  if (!rows.length) return { ok: false as const, error: "That wedding is not published on the server." };
  await sql`update circles set payload = jsonb_set(payload, '{disabled}', ${paused ? "true" : "false"}::jsonb, true), updated_at = now() where slug = ${slug}`;
  await audit(session.email, `${paused ? "Pause" : "Open"} ${slug}`, "Published wedding status changed.", "red", "wedding", "applied", slug);
  return { ok: true as const };
}

export async function userReport(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  const rows = await sql<{ email: string; name: string; updated_at: string }>`select email, name, updated_at from google_connections order by updated_at desc limit 40`;
  return {
    ok: true as const,
    note: "Wedding profiles are stored on each phone, not in this database. The list below is only older Google Drive connections, not the place new photos are stored. Passwords and tokens are not shown.",
    connections: rows,
  };
}

const MEDIA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_OK = /^[a-z0-9-]{3,80}$/;
const COVER_FALLBACK = "/media/demo-hall.svg";

async function mediaTables(sql: Sql) {
  await sql`create table if not exists circle_media (
    id text primary key,
    slug text not null,
    mime text not null,
    chunks integer not null,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists circle_media_part (
    id text not null,
    idx integer not null,
    data text not null,
    primary key (id, idx)
  )`;
  await sql`alter table circle_media add column if not exists provider text not null default 'library'`;
  await sql`alter table circle_media add column if not exists object_path text not null default ''`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function storedRefs(payload: Record<string, unknown>) {
  const found: { ref: string; where: string }[] = [];
  const push = (value: unknown, where: string) => {
    if (typeof value === "string" && value.startsWith("idb:")) found.push({ ref: value, where });
  };
  push(payload.cover, "Cover");
  push(payload.coverVideo, "Cover video");
  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  posts.forEach((post, index) => {
    const row = asRecord(post);
    if (!row) return;
    if (Array.isArray(row.images)) row.images.forEach((src) => push(src, `Post ${index + 1}`));
    push(row.videoLabel, `Post ${index + 1} video`);
    if (Array.isArray(row.videos)) {
      row.videos.forEach((clip) => {
        const item = asRecord(clip);
        if (item) push(item.src, `Post ${index + 1} video`);
      });
    }
  });
  const chats = Array.isArray(payload.chats) ? payload.chats : [];
  chats.forEach((chat) => {
    const room = asRecord(chat);
    if (!room || !Array.isArray(room.messages)) return;
    const name = typeof room.name === "string" && room.name.trim() ? room.name.trim() : "Chat";
    room.messages.forEach((message) => {
      const row = asRecord(message);
      if (!row) return;
      push(row.image, `${name} photo`);
      push(row.video, `${name} video`);
    });
  });
  const notes = Array.isArray(payload.beforeNotes) ? payload.beforeNotes : [];
  notes.forEach((note, index) => {
    const row = asRecord(note);
    if (!row) return;
    if (Array.isArray(row.images)) row.images.forEach((src) => push(src, `Before ${index + 1}`));
    push(row.video, `Before ${index + 1} video`);
  });
  const places = Array.isArray(payload.places) ? payload.places : [];
  places.forEach((place, index) => {
    const row = asRecord(place);
    if (!row) return;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : `Place ${index + 1}`;
    push(row.image, name);
  });
  return found;
}

function stripRef(payload: Record<string, unknown>, ref: string) {
  const next = structuredClone(payload);
  const clear = (value: unknown) => (value === ref ? "" : value);
  if (next.cover === ref) next.cover = COVER_FALLBACK;
  if (next.coverVideo === ref) next.coverVideo = "";
  if (Array.isArray(next.posts)) {
    next.posts = next.posts.map((post) => {
      const row = asRecord(post);
      if (!row) return post;
      return {
        ...row,
        images: Array.isArray(row.images) ? row.images.filter((src) => src !== ref) : row.images,
        videoLabel: clear(row.videoLabel),
        videos: Array.isArray(row.videos)
          ? row.videos.flatMap((clip) => {
              const item = asRecord(clip);
              if (!item || item.src === ref) return [];
              return [item];
            })
          : row.videos,
      };
    });
  }
  if (Array.isArray(next.chats)) {
    next.chats = next.chats.map((chat) => {
      const room = asRecord(chat);
      if (!room || !Array.isArray(room.messages)) return chat;
      return {
        ...room,
        messages: room.messages.map((message) => {
          const row = asRecord(message);
          if (!row) return message;
          return { ...row, image: row.image === ref ? "" : row.image, video: row.video === ref ? "" : row.video };
        }),
      };
    });
  }
  if (Array.isArray(next.beforeNotes)) {
    next.beforeNotes = next.beforeNotes.map((note) => {
      const row = asRecord(note);
      if (!row) return note;
      return {
        ...row,
        images: Array.isArray(row.images) ? row.images.filter((src) => src !== ref) : row.images,
        video: clear(row.video),
      };
    });
  }
  if (Array.isArray(next.places)) {
    next.places = next.places.map((place) => {
      const row = asRecord(place);
      if (!row) return place;
      return { ...row, image: row.image === ref ? "" : row.image };
    });
  }
  return next;
}

export async function pictureReport(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const sql = await getSql();
  await mediaTables(sql);
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const core = await weddingDataSql();
  const rows = await core<{ slug: string; payload: Record<string, unknown> }>`select slug, payload from circles order by updated_at desc limit 40`;
  const media = await sql<{ id: string; slug: string; mime: string; chunks: number }>`select id, slug, mime, chunks from circle_media order by updated_at desc limit 200`;
  const bySlug = new Map<string, typeof media>();
  for (const item of media) {
    const list = bySlug.get(item.slug) ?? [];
    list.push(item);
    bySlug.set(item.slug, list);
  }
  return {
    ok: true as const,
    note: "These are pictures saved on the server for published weddings: covers, posts, chats and notes. Photos that only exist on someone's phone are not here. The sample wedding is not included.",
    weddings: rows
      .filter((row) => row.slug !== "lila-nico")
      .map((row) => {
        const payload = row.payload ?? {};
        const stored = bySlug.get(row.slug) ?? [];
        const used = new Set(storedRefs(payload).map((item) => item.ref.slice(4)));
        const cover = typeof payload.cover === "string" ? payload.cover : "";
        return {
          slug: row.slug,
          bride: typeof payload.bride === "string" ? payload.bride : "",
          groom: typeof payload.groom === "string" ? payload.groom : "",
          cover,
          coverStored: cover.startsWith("idb:"),
          files: stored.map((item) => ({
            id: item.id,
            mime: item.mime,
            chunks: Number(item.chunks) || 0,
            used: used.has(item.id),
            where: storedRefs(payload)
              .filter((ref) => ref.ref === `idb:${item.id}`)
              .map((ref) => ref.where)
              .slice(0, 4),
          })),
        };
      }),
  };
}

export async function uploadWeddingPicture(token: string, slug: string, mime: string, data: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!SLUG_OK.test(slug) || slug === "lila-nico") return { ok: false as const, error: "That wedding cannot be changed here." };
  const cleanMime = mime === "image/png" || mime === "image/webp" || mime === "image/jpeg" ? mime : "";
  if (!cleanMime) return { ok: false as const, error: "Use a JPEG, PNG or WebP picture." };
  const payloadData = data.replace(/\s/g, "");
  if (payloadData.length < 32 || payloadData.length > 900_000 || !/^[A-Za-z0-9+/=]+$/.test(payloadData)) {
    return { ok: false as const, error: "That picture is too large to store. Try a smaller photo." };
  }
  const sql = await getSql();
  await mediaTables(sql);
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const core = await weddingDataSql();
  const rows = await core<{ payload: Record<string, unknown> }>`select payload from circles where slug = ${slug} limit 1`;
  const current = rows[0]?.payload;
  if (!current) return { ok: false as const, error: "That wedding is not published on the server." };
  const { activeMediaDestination } = await import("@/lib/developer/media-destination.server");
  const id = crypto.randomUUID();
  if (await activeMediaDestination(sql) === "firebase") {
    const { saveFirebaseChunk } = await import("@/lib/developer/firebase-storage.server");
    const saved = await saveFirebaseChunk(sql, { slug, id, mime: cleanMime, idx: 0, total: 1, data: payloadData }, true);
    if (!saved.ok) return { ok: false as const, error: "That picture could not be stored in Firebase. The current library was not changed." };
  } else {
    await sql`
      insert into circle_media (id, slug, mime, chunks)
      values (${id}, ${slug}, ${cleanMime}, ${1})
    `;
    await sql`
      insert into circle_media_part (id, idx, data)
      values (${id}, ${0}, ${payloadData})
    `;
  }
  const next = structuredClone(current);
  next.cover = `idb:${id}`;
  await core`update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now() where slug = ${slug}`;
  await audit(session.email, `Upload cover on ${slug}`, `Stored picture ${id}.`, "yellow", "media", "applied", id);
  return { ok: true as const, id };
}

export async function removeWeddingPicture(token: string, slug: string, id: string, confirm: boolean) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!confirm) return { ok: false as const, error: "Confirm before deleting a saved picture." };
  if (!SLUG_OK.test(slug) || slug === "lila-nico") return { ok: false as const, error: "That wedding cannot be changed here." };
  if (!MEDIA_UUID.test(id)) return { ok: false as const, error: "That picture could not be found." };
  const mediaId = id.toLowerCase();
  const sql = await getSql();
  await mediaTables(sql);
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const core = await weddingDataSql();
  const rows = await core<{ payload: Record<string, unknown> }>`select payload from circles where slug = ${slug} limit 1`;
  const current = rows[0]?.payload;
  if (!current) return { ok: false as const, error: "That wedding is not published on the server." };
  const owned = await sql<{ id: string; provider: string; chunks: number }>`select id, provider, chunks from circle_media where id = ${mediaId} and slug = ${slug} limit 1`;
  if (!owned.length) return { ok: false as const, error: "That picture is not stored for this wedding." };
  if (owned[0]?.provider === "firebase") {
    const { ensureMediaProviderColumns } = await import("@/lib/developer/media-destination.server");
    const { deleteFirebaseChunks } = await import("@/lib/developer/firebase-storage.server");
    await ensureMediaProviderColumns(sql);
    const removed = await deleteFirebaseChunks(slug, mediaId, Number(owned[0]?.chunks) || 1);
    if (!removed) return { ok: false as const, error: "That picture is still in Firebase Storage. It was not removed from the wedding." };
    await sql`delete from circle_media_remote where id = ${mediaId}`;
  }
  const next = stripRef(current, `idb:${mediaId}`);
  await core`update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now() where slug = ${slug}`;
  await sql`delete from circle_media_part where id = ${mediaId}`;
  await sql`delete from circle_media where id = ${mediaId} and slug = ${slug}`;
  await audit(session.email, `Delete picture on ${slug}`, `Removed stored picture ${mediaId}.`, "red", "media", "applied", mediaId);
  return { ok: true as const };
}

export async function diagnose(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  const health = await overview(token);
  if (!health.ok) return health;
  if (!openaiConfigured()) {
    return {
      ok: true as const,
      analysis: `CRITICAL ISSUES\n${health.system.database === "down" ? "Database is down." : "None detected from the available checks."}\n\nWARNINGS\nGitHub is not connected.\nDeployment host is not connected.\nOpenAI is not configured. Set the server variable OPENAI_API_KEY.\n\nRECOMMENDED FIXES\nConnect GitHub and the deployment host before expecting commits or production deploys.\n\nSAFE AUTOMATIC FIXES\nNone. Risky changes are not applied from diagnosis.`,
    };
  }
  const result = await openaiComplete(
    [
      {
        role: "system",
        content:
          "Diagnose the application from the status JSON. Plain text with CRITICAL ISSUES, WARNINGS, RECOMMENDED FIXES, SAFE AUTOMATIC FIXES. Do not claim you changed code. Do not invent metrics that are not in the JSON.",
      },
      { role: "user", content: JSON.stringify({ application: health.application, system: health.system, usage: health.usage, errors: health.errors }).slice(0, 8000) },
    ],
    800,
  );
  if (!result.ok) return result;
  await audit(session.email, "Diagnose application", result.text.slice(0, 500), "green", "diagnose", "answered");
  return { ok: true as const, analysis: result.text };
}

export async function runBuild(token: string) {
  const session = await developerSession(token);
  if (!session) return { ok: false as const, error: "Developer session required." };
  if (!workspaceReady()) return { ok: false as const, error: `${projectUnavailableMessage()} No deployment was created.` };
  const build = await run("npm", ["run", "build"], 180000);
  await audit(session.email, "Run build", build.code === 0 ? "Build passed." : "Build failed.", "yellow", "build", build.code === 0 ? "pass" : "fail", "", build.code === 0 ? "" : "Build failed");
  if (build.code !== 0) await recordError("build", "Build failed.", build.output.slice(0, 500));
  return { ok: true as const, passed: build.code === 0, output: build.output || (build.code === 0 ? "Build finished." : "Build failed.") };
}

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
