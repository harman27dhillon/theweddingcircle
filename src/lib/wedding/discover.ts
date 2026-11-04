export const DISCOVER_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "dresses", label: "Dresses" },
  { id: "jewellery", label: "Jewellery" },
  { id: "makeup", label: "Makeup" },
  { id: "footwear", label: "Footwear" },
  { id: "accessories", label: "Accessories" },
] as const;

export type DiscoverCategoryId = (typeof DISCOVER_CATEGORIES)[number]["id"];

export const DISCOVER_BOTS = [
  {
    id: "amazon-india",
    name: "Amazon India Bridal Trends",
    specialization: "Amazon India bridal clothing, jewellery, makeup, and accessories",
    keywords: "bridal lehenga, bridal saree, wedding jewellery set, bridal makeup",
    categories: "dresses,jewellery,makeup,footwear,accessories",
    env: ["AMAZON_PA_ACCESS_KEY", "AMAZON_PA_SECRET_KEY", "AMAZON_PARTNER_TAG"],
  },
  {
    id: "flipkart",
    name: "Flipkart Bridal Trends",
    specialization: "Flipkart bridal clothing, jewellery, makeup, and accessories",
    keywords: "bridal lehenga, saree, jewellery set, bridal heels",
    categories: "dresses,jewellery,makeup,footwear,accessories",
    env: ["FLIPKART_AFFILIATE_ID", "FLIPKART_AFFILIATE_TOKEN"],
  },
  {
    id: "meesho",
    name: "Meesho Bridal Trends",
    specialization: "Meesho bridal clothing, jewellery, makeup, and accessories",
    keywords: "bridal lehenga, saree, bangles, potli bag",
    categories: "dresses,jewellery,makeup,footwear,accessories",
    env: ["MEESHO_CATALOG_TOKEN"],
  },
  {
    id: "bridal-dress",
    name: "Bridal Dress Research",
    specialization: "Trending bridal lehengas, sarees, reception outfits, and wedding clothing",
    keywords: "bridal lehenga, wedding saree, reception gown, bridal suit",
    categories: "dresses",
    env: [] as string[],
  },
  {
    id: "bridal-jewellery",
    name: "Bridal Jewellery Research",
    specialization: "Bridal jewellery sets, necklaces, earrings, bangles, maang tikka, nath, and kaleere",
    keywords: "bridal jewellery set, maang tikka, nath, kaleere, bangles",
    categories: "jewellery",
    env: [] as string[],
  },
] as const;

export type DiscoverBotId = (typeof DISCOVER_BOTS)[number]["id"];

const RESEARCH = new Set<DiscoverBotId>(["bridal-dress", "bridal-jewellery"]);
const RETAILER_MARKERS = ["AMAZON_PA_ACCESS_KEY", "FLIPKART_AFFILIATE_ID", "MEESHO_CATALOG_TOKEN"];

export type SourceReadiness = {
  status: "needs_connection" | "not_configured";
  label: "Needs connection" | "Not configured";
  missing: string[];
  detail: string;
};

export function sourceReadiness(botId: string, present: ReadonlySet<string>): SourceReadiness {
  const bot = DISCOVER_BOTS.find((item) => item.id === botId);
  if (!bot) {
    return { status: "not_configured", label: "Not configured", missing: [], detail: "That discovery bot is not part of this app." };
  }
  if (RESEARCH.has(bot.id)) {
    const found = RETAILER_MARKERS.filter((name) => present.has(name));
    if (!found.length) {
      return {
        status: "needs_connection",
        label: "Needs connection",
        missing: ["AMAZON_PA_ACCESS_KEY or FLIPKART_AFFILIATE_ID or MEESHO_CATALOG_TOKEN"],
        detail: "No approved retailer credential is available, so this bot did not search and did not create products.",
      };
    }
    return {
      status: "not_configured",
      label: "Not configured",
      missing: [],
      detail: "A retailer credential is present, but no approved product feed is connected for this research bot. No products were added.",
    };
  }
  const missing = bot.env.filter((name) => !present.has(name));
  if (missing.length) {
    return {
      status: "needs_connection",
      label: "Needs connection",
      missing: [...missing],
      detail: `Missing ${missing.join(", ")}. This bot did not search and did not create products.`,
    };
  }
  return {
    status: "not_configured",
    label: "Not configured",
    missing: [],
    detail: "The named credentials are present, but this build does not call that retailer yet. No products were added.",
  };
}

export function categoryId(value: string): DiscoverCategoryId {
  return DISCOVER_CATEGORIES.some((item) => item.id === value) ? (value as DiscoverCategoryId) : "all";
}

export function productKey(source: string, sourceProductId: string) {
  return `${source.trim().toLowerCase()}::${sourceProductId.trim()}`;
}

export function dedupeProducts<T extends { source: string; sourceProductId: string }>(items: T[]) {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const key = productKey(item.source, item.sourceProductId);
    if (key === "::" || seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export function httpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

const CATEGORY_SET = new Set<string>(DISCOVER_CATEGORIES.map((item) => item.id).filter((id) => id !== "all"));

export function cleanBotDraft(input: {
  id?: string;
  enabled?: boolean;
  keywords?: string;
  categories?: string;
  scheduleEnabled?: boolean;
  scheduleHours?: number;
  maxResults?: number;
  freshnessDays?: number;
  moderate?: boolean;
  rankingNote?: string;
}) {
  const bot = DISCOVER_BOTS.find((item) => item.id === input.id);
  if (!bot) return { ok: false as const, error: "That bot is not part of Discover." };
  const keywords = (input.keywords ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
  if (keywords.length < 3) return { ok: false as const, error: "Add at least one bridal search phrase." };
  const categories = (input.categories ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => CATEGORY_SET.has(item));
  const unique = [...new Set(categories)];
  if (!unique.length) return { ok: false as const, error: "Choose at least one bridal category." };
  const scheduleHours = Number(input.scheduleHours);
  const maxResults = Number(input.maxResults);
  const freshnessDays = Number(input.freshnessDays);
  if (!Number.isInteger(scheduleHours) || scheduleHours < 6 || scheduleHours > 168) {
    return { ok: false as const, error: "Schedule the bot between 6 and 168 hours." };
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 40) {
    return { ok: false as const, error: "Keep each run between 1 and 40 products." };
  }
  if (!Number.isInteger(freshnessDays) || freshnessDays < 1 || freshnessDays > 60) {
    return { ok: false as const, error: "Keep products fresh for 1 to 60 days." };
  }
  return {
    ok: true as const,
    value: {
      id: bot.id,
      enabled: Boolean(input.enabled),
      keywords,
      categories: unique.join(","),
      scheduleEnabled: Boolean(input.scheduleEnabled),
      scheduleHours,
      maxResults,
      freshnessDays,
      moderate: input.moderate !== false,
      rankingNote: (input.rankingNote ?? "").trim().slice(0, 400),
    },
  };
}
