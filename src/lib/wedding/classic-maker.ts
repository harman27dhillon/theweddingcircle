/** Developer Classic themes and the mobile landing background. Colors and asset paths only — never wedding records. */

export const CUSTOM_THEME_ID = /^classic-custom-[a-z0-9]{8}$/;

export const COLOR_FIELDS = [
  ["page", "Main page background"],
  ["panel", "Secondary page or panel background"],
  ["text", "Primary text"],
  ["textSecondary", "Secondary text"],
  ["button", "Primary buttons"],
  ["buttonSecondary", "Secondary buttons"],
  ["buttonText", "Button text"],
  ["accent", "Borders and decorative accents"],
  ["card", "Cards and tiles"],
  ["chatBubble", "Chat bubbles"],
  ["chatText", "Chat text"],
  ["nav", "Navigation bar"],
  ["heading", "Headings and labels"],
  ["barText", "Wedding-bar text"],
  ["live", "Live and album accents"],
] as const;

export type ClassicColorKey = (typeof COLOR_FIELDS)[number][0];
export type ClassicColors = Record<ClassicColorKey, string>;

export const IMAGE_SLOTS = [
  ["landingDesktop", "Desktop landing page"],
  ["landingMobile", "Mobile landing page"],
  ["barDesktop", "Desktop wedding card"],
  ["barMobile", "Mobile wedding card"],
] as const;

export type ImageSlotKey = (typeof IMAGE_SLOTS)[number][0];
export type ImageFit = "cover" | "contain";
export type ImagePosition = "center" | "top" | "bottom" | "left" | "right";

export type ThemeImage = {
  src: string;
  fit: ImageFit;
  position: ImagePosition;
  bundled: boolean;
};

export type ClassicThemeRecord = {
  id: string;
  name: string;
  colors: ClassicColors;
  images: Record<ImageSlotKey, ThemeImage>;
};

export type MobileLandingBackground = {
  src: string;
  fit: ImageFit;
  position: ImagePosition;
  bundled: boolean;
} | null;

export type AppearanceConfig = {
  updatedAt: string;
  mobileLanding: MobileLandingBackground;
  landingBackground: MobileLandingBackground;
  ceremonyBackground: MobileLandingBackground;
  themes: ClassicThemeRecord[];
};

export const DEFAULT_COLORS: ClassicColors = {
  page: "#f4efe8",
  panel: "#fbf8f4",
  text: "#1c1412",
  textSecondary: "#7a6a62",
  button: "#8c2f39",
  buttonSecondary: "#a68456",
  buttonText: "#fbf8f4",
  accent: "#a68456",
  card: "#fffdfb",
  chatBubble: "#8c2f39",
  chatText: "#fbf8f4",
  nav: "#f4efe8",
  heading: "#8c2f39",
  barText: "#fffaf4",
  live: "#8c2f39",
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const FITS = new Set<ImageFit>(["cover", "contain"]);
const POSITIONS = new Set<ImagePosition>(["center", "top", "bottom", "left", "right"]);
const BUILTIN = new Set(["classic-default", "classic-ivory"]);

export function emptyImage(): ThemeImage {
  return { src: "", fit: "cover", position: "center", bundled: false };
}

export function defaultColors(): ClassicColors {
  return { ...DEFAULT_COLORS };
}

export function emptyAppearance(): AppearanceConfig {
  return { updatedAt: "", mobileLanding: null, landingBackground: null, ceremonyBackground: null, themes: [] };
}

export function isCustomClassicId(value: string) {
  return CUSTOM_THEME_ID.test(value);
}

function hex(value: unknown, fallback: string) {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function assetPath(value: unknown) {
  if (typeof value !== "string") return "";
  const src = value.trim();
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.includes("..")) return "";
  if (src.startsWith("/assets/developer/") || src.startsWith("/card-themes/") || src.startsWith("/library/") || src.startsWith("/media/") || src.startsWith("/covers/")) return src.slice(0, 240);
  return "";
}

function imageOf(value: unknown): ThemeImage {
  const raw = value && typeof value === "object" ? value as Partial<ThemeImage> : {};
  const fit = FITS.has(raw.fit as ImageFit) ? raw.fit as ImageFit : "cover";
  const position = POSITIONS.has(raw.position as ImagePosition) ? raw.position as ImagePosition : "center";
  const src = assetPath(raw.src);
  return { src, fit, position, bundled: Boolean(src) && raw.bundled === true };
}

export function sanitizeTheme(value: unknown): ClassicThemeRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ClassicThemeRecord> & { weddingId?: unknown; cardTheme?: unknown };
  if ("weddingId" in raw || raw.cardTheme) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!isCustomClassicId(id) || BUILTIN.has(id)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ").slice(0, 48) : "";
  if (name.length < 2) return null;
  const colors = {} as ClassicColors;
  const incoming = raw.colors && typeof raw.colors === "object" ? raw.colors : {};
  for (const [key] of COLOR_FIELDS) colors[key] = hex((incoming as Record<string, unknown>)[key], DEFAULT_COLORS[key]);
  const images = {} as Record<ImageSlotKey, ThemeImage>;
  const incomingImages = raw.images && typeof raw.images === "object" ? raw.images : {};
  for (const [key] of IMAGE_SLOTS) images[key] = imageOf((incomingImages as Record<string, unknown>)[key]);
  return { id, name, colors, images };
}

function backgroundOf(value: unknown): MobileLandingBackground {
  if (!value || typeof value !== "object") return null;
  const image = imageOf(value);
  return image.src ? image : null;
}

export function sanitizeAppearance(value: unknown): AppearanceConfig {
  const empty = emptyAppearance();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Partial<AppearanceConfig> & { weddingId?: unknown };
  if ("weddingId" in raw) return empty;
  const themes: ClassicThemeRecord[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.themes) ? raw.themes.slice(0, 24) : []) {
    const theme = sanitizeTheme(item);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    themes.push(theme);
  }
  const mobileLanding = backgroundOf(raw.mobileLanding);
  const landingBackground = backgroundOf(raw.landingBackground);
  const ceremonyBackground = backgroundOf(raw.ceremonyBackground);
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt.slice(0, 40) : "";
  return { updatedAt, mobileLanding, landingBackground, ceremonyBackground, themes };
}

export function parseAppearance(value: unknown): AppearanceConfig {
  if (typeof value === "string") {
    try {
      return sanitizeAppearance(JSON.parse(value));
    } catch {
      return emptyAppearance();
    }
  }
  return sanitizeAppearance(value);
}

export function newThemeId() {
  const alphabet = "abcdef0123456789";
  let tail = "";
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(8));
  if (bytes) {
    for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  } else {
    tail = Math.random().toString(16).slice(2, 10).padEnd(8, "a");
  }
  return `classic-custom-${tail.slice(0, 8)}`;
}

export function freshTheme(name = "New Classic"): ClassicThemeRecord {
  return {
    id: newThemeId(),
    name,
    colors: defaultColors(),
    images: {
      landingDesktop: emptyImage(),
      landingMobile: emptyImage(),
      barDesktop: emptyImage(),
      barMobile: emptyImage(),
    },
  };
}

let customThemes: ClassicThemeRecord[] = [];

export function readCustomThemes() {
  return customThemes;
}

export function replaceCustomThemes(next: ClassicThemeRecord[]) {
  customThemes = next;
}
