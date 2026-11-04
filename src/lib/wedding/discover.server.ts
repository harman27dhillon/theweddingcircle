import { randomUUID } from "node:crypto";
import { getSql, type Sql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { env } from "@/lib/env.server";
import {
  DISCOVER_BOTS,
  categoryId,
  cleanBotDraft,
  httpsUrl,
  sourceReadiness,
  type DiscoverBotId,
  type DiscoverCategoryId,
} from "@/lib/wedding/discover";

const PAGE = 24;

async function ensure(sql: Sql) {
  await sql`create table if not exists discover_bots (
    id text primary key,
    name text not null,
    specialization text not null,
    enabled boolean not null default false,
    keywords text not null default '',
    categories text not null default '',
    schedule_enabled boolean not null default false,
    schedule_hours integer not null default 24,
    max_results integer not null default 24,
    freshness_days integer not null default 14,
    moderate boolean not null default true,
    ranking_note text not null default '',
    last_run_at timestamptz,
    last_success_at timestamptz,
    next_run_at timestamptz,
    last_error text not null default '',
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists discover_runs (
    id text primary key,
    bot_id text not null,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    status text not null,
    found integer not null default 0,
    error text not null default '',
    trigger text not null default 'manual'
  )`;
  await sql`create table if not exists discover_products (
    id text primary key,
    source text not null,
    source_product_id text not null,
    source_label text not null,
    source_url text not null,
    name text not null,
    description text not null default '',
    image_url text not null default '',
    price_amount text not null default '',
    price_currency text not null default '',
    price_checked_at timestamptz,
    category text not null,
    attributes text not null default '{}',
    availability text not null default 'unknown',
    trend_label text not null default '',
    trend_origin text not null default '',
    trend_at timestamptz,
    sponsored boolean not null default false,
    published boolean not null default false,
    excluded boolean not null default false,
    discovered_at timestamptz not null default now(),
    last_checked_at timestamptz not null default now(),
    bot_id text not null,
    unique (source, source_product_id)
  )`;
  for (const bot of DISCOVER_BOTS) {
    await sql`insert into discover_bots (id, name, specialization, keywords, categories)
      values (${bot.id}, ${bot.name}, ${bot.specialization}, ${bot.keywords}, ${bot.categories})
      on conflict (id) do nothing`;
  }
}

function presentCredentials() {
  const names = [...new Set(DISCOVER_BOTS.flatMap((bot) => [...bot.env, "AMAZON_PA_ACCESS_KEY", "FLIPKART_AFFILIATE_ID", "MEESHO_CATALOG_TOKEN"]))];
  return new Set(names.filter((name) => env(name)));
}

async function loadCredentialNames(sql: Sql) {
  const names = presentCredentials();
  try {
    const { storedCredentialNames } = await import("@/lib/wedding/affiliate.server");
    for (const name of await storedCredentialNames(sql)) names.add(name);
  } catch {
    /* An unreadable vault does not count as a connected retailer. */
  }
  return names;
}

type BotRow = {
  id: string;
  name: string;
  specialization: string;
  enabled: boolean;
  keywords: string;
  categories: string;
  schedule_enabled: boolean;
  schedule_hours: number;
  max_results: number;
  freshness_days: number;
  moderate: boolean;
  ranking_note: string;
  last_run_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  last_error: string;
};

function stamp(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function botView(row: BotRow, count: number, names: Set<string>) {
  const ready = sourceReadiness(row.id, names);
  return {
    id: row.id as DiscoverBotId,
    name: row.name,
    specialization: row.specialization,
    enabled: Boolean(row.enabled),
    keywords: row.keywords,
    categories: row.categories,
    scheduleEnabled: Boolean(row.schedule_enabled),
    scheduleHours: Number(row.schedule_hours) || 24,
    maxResults: Number(row.max_results) || 24,
    freshnessDays: Number(row.freshness_days) || 14,
    moderate: row.moderate !== false,
    rankingNote: row.ranking_note || "",
    lastRunAt: stamp(row.last_run_at),
    lastSuccessAt: stamp(row.last_success_at),
    nextRunAt: row.schedule_enabled ? stamp(row.next_run_at) : "",
    lastError: row.last_error || "",
    productCount: count,
    connection: ready.label,
    connectionStatus: ready.status,
    missing: ready.missing,
    detail: ready.detail,
    operational: false,
  };
}

async function counts(sql: Sql) {
  const rows = await sql<{ bot_id: string; total: number }>`
    select bot_id, count(*)::int as total from discover_products where excluded = false group by bot_id
  `;
  return new Map(rows.map((row) => [row.bot_id, Number(row.total) || 0]));
}

export type PublicProduct = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  priceAmount: string;
  priceCurrency: string;
  priceCheckedAt: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  category: string;
  attributes: Record<string, string>;
  availability: string;
  trendLabel: string;
  trendOrigin: string;
  sponsored: boolean;
  lastCheckedAt: string;
};

function asAttributes(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
        .slice(0, 12),
    );
  } catch {
    return {};
  }
}

type ProductRow = {
  id: string;
  source: string;
  source_label: string;
  source_url: string;
  name: string;
  description: string;
  image_url: string;
  price_amount: string;
  price_currency: string;
  price_checked_at: string | null;
  category: string;
  attributes: string;
  availability: string;
  trend_label: string;
  trend_origin: string;
  sponsored: boolean;
  last_checked_at: string | null;
};

function publicProduct(row: ProductRow): PublicProduct {
  const unavailable = row.availability === "unavailable";
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    imageUrl: httpsUrl(row.image_url || ""),
    priceAmount: unavailable ? "" : row.price_amount || "",
    priceCurrency: unavailable ? "" : row.price_currency || "",
    priceCheckedAt: unavailable ? "" : stamp(row.price_checked_at),
    source: row.source,
    sourceLabel: row.source_label || row.source,
    sourceUrl: httpsUrl(row.source_url || ""),
    category: row.category,
    attributes: asAttributes(row.attributes || "{}"),
    availability: row.availability || "unknown",
    trendLabel: row.trend_origin ? row.trend_label || "" : "",
    trendOrigin: row.trend_origin || "",
    sponsored: Boolean(row.sponsored),
    lastCheckedAt: stamp(row.last_checked_at),
  };
}

export async function listDiscover(category: DiscoverCategoryId, offset: number) {
  const sql = await getSql();
  await ensure(sql);
  const start = Number.isInteger(offset) && offset > 0 ? Math.min(offset, 500) : 0;
  const chosen = categoryId(category);
  const rows = await sql<ProductRow>`
    select id, source, source_label, source_url, name, description, image_url, price_amount, price_currency,
      price_checked_at, category, attributes, availability, trend_label, trend_origin, sponsored, last_checked_at
    from discover_products
    where published = true and excluded = false and (${chosen} = 'all' or category = ${chosen})
    order by discovered_at desc, id desc
    limit ${PAGE} offset ${start}
  `;
  const present = await loadCredentialNames(sql);
  const needsConnection = DISCOVER_BOTS.filter((bot) => sourceReadiness(bot.id, present).status === "needs_connection").length;
  return {
    ok: true as const,
    category: chosen,
    items: rows.map(publicProduct),
    nextOffset: rows.length === PAGE ? start + PAGE : null,
    sourcesConnected: 0,
    needsConnection,
    sourceCount: DISCOVER_BOTS.length,
  };
}

export async function discoverBots(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await getSql();
  await ensure(sql);
  const rows = await sql<BotRow>`select * from discover_bots order by name asc`;
  const present = await loadCredentialNames(sql);
  const totals = await counts(sql);
  const runs = await sql<{ id: string; bot_id: string; started_at: string; finished_at: string | null; status: string; found: number; error: string; trigger: string }>`
    select id, bot_id, started_at, finished_at, status, found, error, trigger from discover_runs order by started_at desc limit 40
  `;
  const products = await sql<{ id: string; bot_id: string; name: string; source_label: string; source_url: string; published: boolean; excluded: boolean; availability: string; category: string }>`
    select id, bot_id, name, source_label, source_url, published, excluded, availability, category
    from discover_products order by discovered_at desc limit 80
  `;
  return {
    ok: true as const,
    bots: rows.map((row) => botView(row, totals.get(row.id) ?? 0, present)),
    runs: runs.map((run) => ({
      id: run.id,
      botId: run.bot_id,
      startedAt: stamp(run.started_at),
      finishedAt: stamp(run.finished_at),
      status: run.status,
      found: Number(run.found) || 0,
      error: run.error || "",
      trigger: run.trigger,
    })),
    products: products.map((item) => ({
      id: item.id,
      botId: item.bot_id,
      name: item.name,
      sourceLabel: item.source_label,
      sourceUrl: httpsUrl(item.source_url || ""),
      published: Boolean(item.published),
      excluded: Boolean(item.excluded),
      availability: item.availability,
      category: item.category,
    })),
  };
}

export async function saveDiscoverBot(token: string, input: Parameters<typeof cleanBotDraft>[0] & { confirm?: boolean }) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const clean = cleanBotDraft(input);
  if (!clean.ok) return clean;
  const sql = await getSql();
  await ensure(sql);
  const current = (await sql<BotRow>`select * from discover_bots where id = ${clean.value.id} limit 1`)[0];
  if (!current) return { ok: false as const, error: "That bot is not available." };
  const behaviorChanged =
    Boolean(current.enabled) !== clean.value.enabled ||
    Boolean(current.schedule_enabled) !== clean.value.scheduleEnabled ||
    Number(current.schedule_hours) !== clean.value.scheduleHours ||
    (current.moderate !== false) !== clean.value.moderate;
  if (behaviorChanged && input.confirm !== true) {
    return { ok: false as const, error: "Confirm this change. It affects the schedule or what can be published." };
  }
  const nextRun = clean.value.scheduleEnabled ? new Date(Date.now() + clean.value.scheduleHours * 60 * 60 * 1000).toISOString() : null;
  await sql`update discover_bots set
    enabled = ${clean.value.enabled},
    keywords = ${clean.value.keywords},
    categories = ${clean.value.categories},
    schedule_enabled = ${clean.value.scheduleEnabled},
    schedule_hours = ${clean.value.scheduleHours},
    max_results = ${clean.value.maxResults},
    freshness_days = ${clean.value.freshnessDays},
    moderate = ${clean.value.moderate},
    ranking_note = ${clean.value.rankingNote},
    next_run_at = ${nextRun},
    updated_at = now()
    where id = ${clean.value.id}`;
  return { ok: true as const };
}

export async function runDiscoverBot(token: string, botId: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const bot = DISCOVER_BOTS.find((item) => item.id === botId);
  if (!bot) return { ok: false as const, error: "That bot is not part of Discover." };
  const sql = await getSql();
  await ensure(sql);
  const recent = (await sql<{ started_at: string }>`select started_at from discover_runs where bot_id = ${bot.id} order by started_at desc limit 1`)[0];
  if (recent && Date.now() - new Date(recent.started_at).getTime() < 20_000) {
    return { ok: false as const, error: "Wait a moment before running this bot again." };
  }
  const ready = sourceReadiness(bot.id, await loadCredentialNames(sql));
  const id = randomUUID();
  await sql`insert into discover_runs (id, bot_id, status, found, error, trigger, finished_at)
    values (${id}, ${bot.id}, ${ready.status}, ${0}, ${ready.detail}, ${"manual"}, now())`;
  await sql`update discover_bots set
    last_run_at = now(),
    last_error = ${ready.detail},
    updated_at = now()
    where id = ${bot.id}`;
  return { ok: true as const, status: ready.status, found: 0, detail: ready.detail };
}

export async function reviewDiscoverProduct(token: string, id: string, action: "publish" | "hold" | "exclude" | "restore") {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false as const, error: "That product could not be found." };
  const sql = await getSql();
  await ensure(sql);
  const row = (await sql<{ id: string }>`select id from discover_products where id = ${id} limit 1`)[0];
  if (!row) return { ok: false as const, error: "That product is not in Discover." };
  if (action === "publish") await sql`update discover_products set published = true, excluded = false where id = ${id}`;
  else if (action === "hold") await sql`update discover_products set published = false where id = ${id}`;
  else if (action === "exclude") await sql`update discover_products set excluded = true, published = false where id = ${id}`;
  else await sql`update discover_products set excluded = false, published = false where id = ${id}`;
  return { ok: true as const };
}
