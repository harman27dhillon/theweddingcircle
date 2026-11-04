export type BarPoint = { x: number; y: number };
export type CoverFrame = { x: number; y: number; zoom: number };

/** Host layout for one wedding bar. Missing pieces keep the theme and the normal text placement. */
export type WeddingBarLayout = {
  cover?: string;
  /** Legacy single crop. Only the theme that owned it may read it, then it is parked into `frames`. */
  frame?: CoverFrame;
  /** Cover crop for one theme. Keyed by theme id so dragging one theme cannot move another. */
  frames?: Record<string, CoverFrame>;
  names?: BarPoint;
  date?: BarPoint;
  place?: BarPoint;
};

function point(value: unknown): BarPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { x?: unknown; y?: unknown };
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const clamp = (n: number) => Math.min(92, Math.max(8, Math.round(n * 10) / 10));
  return { x: clamp(x), y: clamp(y) };
}

function frameOf(value: unknown): CoverFrame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { x?: unknown; y?: unknown; zoom?: unknown };
  const x = Number(raw.x);
  const y = Number(raw.y);
  const zoom = Number(raw.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return undefined;
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100), zoom: clamp(zoom, 1, 3) };
}
function framesOf(value: unknown): Record<string, CoverFrame> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, CoverFrame> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) continue;
    const frame = frameOf(raw);
    if (!frame) continue;
    out[key] = frame;
    if (Object.keys(out).length >= 40) break;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The crop saved for this theme. A leftover single `frame` belongs only to the theme that is active. */
export function frameForTheme(bar: WeddingBarLayout | undefined, themeId: string, activeThemeId?: string): CoverFrame | undefined {
  if (!bar || !themeId) return undefined;
  const own = bar.frames?.[themeId];
  if (own) return own;
  if (bar.frame && !bar.frames && activeThemeId && themeId === activeThemeId) return bar.frame;
  return undefined;
}

/** Move a leftover single crop onto the theme that currently owns it, so the next theme starts clean. */
export function parkLegacyFrame(bar: WeddingBarLayout | undefined, themeId: string): WeddingBarLayout | undefined {
  if (!bar?.frame || !themeId) return bar;
  const frames = { ...(bar.frames ?? {}) };
  if (!frames[themeId]) frames[themeId] = bar.frame;
  const next: WeddingBarLayout = { ...bar, frames };
  delete next.frame;
  return next;
}
function coverOf(value: unknown) {
  if (typeof value !== "string") return "";
  const src = value.trim();
  if (!src) return "";
  if (src.startsWith("/covers/") || src.startsWith("/library/") || src.startsWith("/media/") || src.startsWith("/card-themes/") || src.startsWith("/api/library/")) {
    return src.slice(0, 240);
  }
  if ((src.startsWith("https://") || src.startsWith("http://")) && src.length <= 240) return src;
  if (src.startsWith("idb:") && /^idb:[0-9a-f-]{36}$/i.test(src)) return src;
  if ((src.startsWith("data:image/jpeg") || src.startsWith("data:image/png") || src.startsWith("data:image/webp")) && src.length <= 450_000) return src;
  return "";
}

/** Drops anything a host is not allowed to store on the bar. Empty means “use the defaults”. */
export function sanitizeBar(value: unknown): WeddingBarLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { cover?: unknown; frame?: unknown; frames?: unknown; names?: unknown; date?: unknown; place?: unknown };
  const cover = coverOf(raw.cover);
  const frame = frameOf(raw.frame);
  const frames = framesOf(raw.frames);
  const names = point(raw.names);
  const date = point(raw.date);
  const place = point(raw.place);
  if (!cover && !frame && !frames && !names && !date && !place) return undefined;
  return {
    ...(cover ? { cover } : {}),
    ...(frame ? { frame } : {}),
    ...(frames ? { frames } : {}),
    ...(names ? { names } : {}),
    ...(date ? { date } : {}),
    ...(place ? { place } : {}),
  };
}
