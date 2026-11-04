import { createServerFn } from "@tanstack/react-start";
import { categoryId, type DiscoverCategoryId } from "@/lib/wedding/discover";

function text(value: unknown, max = 400) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function flag(value: unknown) {
  return value === true;
}

function whole(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export const listDiscoverProducts = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const body = input && typeof input === "object" ? (input as { category?: unknown; offset?: unknown }) : {};
    const offset = typeof body.offset === "number" && Number.isInteger(body.offset) ? body.offset : 0;
    return { category: categoryId(text(body.category, 40)) as DiscoverCategoryId, offset };
  })
  .handler(async ({ data }) => {
    const { listDiscover } = await import("@/lib/wedding/discover.server");
    return listDiscover(data.category, data.offset);
  });

export const developerDiscoverBots = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { discoverBots } = await import("@/lib/wedding/discover.server");
    return discoverBots(data.token);
  });

export const developerSaveDiscoverBot = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as Record<string, unknown>;
    return {
      token: text(body?.token, 200),
      id: text(body?.id, 40),
      enabled: flag(body?.enabled),
      keywords: text(body?.keywords, 400),
      categories: text(body?.categories, 200),
      scheduleEnabled: flag(body?.scheduleEnabled),
      scheduleHours: whole(body?.scheduleHours, 24),
      maxResults: whole(body?.maxResults, 24),
      freshnessDays: whole(body?.freshnessDays, 14),
      moderate: body?.moderate !== false,
      rankingNote: text(body?.rankingNote, 400),
      confirm: flag(body?.confirm),
    };
  })
  .handler(async ({ data }) => {
    const { saveDiscoverBot } = await import("@/lib/wedding/discover.server");
    const { token, ...draft } = data;
    return saveDiscoverBot(token, draft);
  });

export const developerRunDiscoverBot = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 40) };
  })
  .handler(async ({ data }) => {
    const { runDiscoverBot } = await import("@/lib/wedding/discover.server");
    return runDiscoverBot(data.token, data.id);
  });

function reviewAction(value: unknown): "publish" | "hold" | "exclude" | "restore" {
  if (value === "publish" || value === "hold" || value === "exclude" || value === "restore") return value;
  return "hold";
}

export const developerReviewDiscoverProduct = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; action?: unknown };
    return {
      token: text(body?.token, 200),
      id: text(body?.id, 80),
      action: reviewAction(body?.action),
    };
  })
  .handler(async ({ data }) => {
    const { reviewDiscoverProduct } = await import("@/lib/wedding/discover.server");
    return reviewDiscoverProduct(data.token, data.id, data.action);
  });
