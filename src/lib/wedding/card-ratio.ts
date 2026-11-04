/** Global developer display settings. These are not a wedding's theme or a user's pin. */

export const CARD_RATIO_PRESETS = [
  { id: "3:4", label: "Portrait", w: 3, h: 4 },
  { id: "9:16", label: "Tall Portrait", w: 9, h: 16 },
  { id: "1:1", label: "Square", w: 1, h: 1 },
  { id: "4:3", label: "Landscape", w: 4, h: 3 },
  { id: "16:9", label: "Wide Landscape", w: 16, h: 9 },
] as const;

/** The card the app already uses: width 1, height 1.08. */
export const ORIGINAL_CARD_RATIO = { w: 1, h: 1.08, original: true as const, id: "original" };

export type ResolvedCardRatio = {
  w: number;
  h: number;
  original: boolean;
  id: string;
};

const MIN_PART = 1;
const MAX_PART = 32;
const MIN_SHAPE = 0.45;
const MAX_SHAPE = 2.4;

export function isSafeCardRatio(w: number, h: number) {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w < MIN_PART || h < MIN_PART || w > MAX_PART || h > MAX_PART) return false;
  const shape = w / h;
  return shape >= MIN_SHAPE && shape <= MAX_SHAPE;
}

function trimPart(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

/** Stored value, or null when the choice is not a supported ratio. */
export function canonicalCardRatio(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw || raw === "original") return "original";
  if (CARD_RATIO_PRESETS.some((item) => item.id === raw)) return raw;
  const custom = /^custom:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(raw);
  if (!custom) return null;
  const w = Number(custom[1]);
  const h = Number(custom[2]);
  if (!isSafeCardRatio(w, h)) return null;
  return `custom:${trimPart(w)}:${trimPart(h)}`;
}

export function resolveCardRatio(value: string | null | undefined): ResolvedCardRatio {
  const stored = canonicalCardRatio(value) ?? "original";
  if (stored === "original") return { ...ORIGINAL_CARD_RATIO };
  const preset = CARD_RATIO_PRESETS.find((item) => item.id === stored);
  if (preset) return { w: preset.w, h: preset.h, original: false, id: preset.id };
  const custom = /^custom:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(stored);
  if (!custom) return { ...ORIGINAL_CARD_RATIO };
  return { w: Number(custom[1]), h: Number(custom[2]), original: false, id: "custom" };
}

export function cardRatioChoice(id: string, width: number, height: number) {
  if (id === "custom") return canonicalCardRatio(`custom:${width}:${height}`);
  return canonicalCardRatio(id);
}

export function cardDisplayFromConfig(config: { cards?: { landing?: string; landingDesktop?: string; pinned?: string; pinnedFull?: boolean; pinnedBar?: string } } | null | undefined): {
  landing: ResolvedCardRatio;
  landingDesktop: ResolvedCardRatio;
  pinned: ResolvedCardRatio;
  pinnedFull: boolean;
  pinnedBar: ResolvedCardRatio;
} {
  return {
    landing: resolveCardRatio(config?.cards?.landing),
    landingDesktop: resolveCardRatio(config?.cards?.landingDesktop),
    pinned: resolveCardRatio(config?.cards?.pinned),
    pinnedFull: config?.cards?.pinnedFull === true,
    pinnedBar: resolveCardRatio(config?.cards?.pinnedBar),
  };
}
