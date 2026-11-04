import type { CSSProperties } from "react";

/** Wedding text roles. Chat and the app mark never read these. */
export type FontRole = "names" | "ceremonyHead" | "ceremonyBody" | "headings" | "body";

export type WeddingFonts = Partial<Record<FontRole, string>>;

export type WeddingFont = {
  id: string;
  family: string;
  category: "Serif" | "Script" | "Sans" | "Editorial" | "Decorative";
  fallback: string;
};

const SERIF = "Georgia, serif";
const SANS = "sans-serif";
const SCRIPT = "cursive";

export const WEDDING_FONTS: WeddingFont[] = [
  { id: "cormorant-garamond", family: "Cormorant Garamond", category: "Serif", fallback: SERIF },
  { id: "playfair-display", family: "Playfair Display", category: "Serif", fallback: SERIF },
  { id: "libre-baskerville", family: "Libre Baskerville", category: "Serif", fallback: SERIF },
  { id: "eb-garamond", family: "EB Garamond", category: "Serif", fallback: SERIF },
  { id: "cinzel", family: "Cinzel", category: "Serif", fallback: SERIF },
  { id: "cormorant", family: "Cormorant", category: "Serif", fallback: SERIF },
  { id: "spectral", family: "Spectral", category: "Serif", fallback: SERIF },
  { id: "lora", family: "Lora", category: "Serif", fallback: SERIF },
  { id: "crimson-pro", family: "Crimson Pro", category: "Serif", fallback: SERIF },
  { id: "newsreader", family: "Newsreader", category: "Editorial", fallback: SERIF },
  { id: "bodoni-moda", family: "Bodoni Moda", category: "Editorial", fallback: SERIF },
  { id: "instrument-serif", family: "Instrument Serif", category: "Editorial", fallback: SERIF },
  { id: "fraunces", family: "Fraunces", category: "Editorial", fallback: SERIF },
  { id: "cardo", family: "Cardo", category: "Serif", fallback: SERIF },
  { id: "literata", family: "Literata", category: "Editorial", fallback: SERIF },
  { id: "source-serif-4", family: "Source Serif 4", category: "Serif", fallback: SERIF },
  { id: "petrona", family: "Petrona", category: "Serif", fallback: SERIF },
  { id: "domine", family: "Domine", category: "Serif", fallback: SERIF },
  { id: "young-serif", family: "Young Serif", category: "Serif", fallback: SERIF },
  { id: "marcellus", family: "Marcellus", category: "Decorative", fallback: SERIF },
  { id: "italiana", family: "Italiana", category: "Decorative", fallback: SERIF },
  { id: "sorts-mill-goudy", family: "Sorts Mill Goudy", category: "Serif", fallback: SERIF },
  { id: "gilda-display", family: "Gilda Display", category: "Decorative", fallback: SERIF },
  { id: "bellefair", family: "Bellefair", category: "Serif", fallback: SERIF },
  { id: "great-vibes", family: "Great Vibes", category: "Script", fallback: SCRIPT },
  { id: "allura", family: "Allura", category: "Script", fallback: SCRIPT },
  { id: "alex-brush", family: "Alex Brush", category: "Script", fallback: SCRIPT },
  { id: "pinyon-script", family: "Pinyon Script", category: "Script", fallback: SCRIPT },
  { id: "tangerine", family: "Tangerine", category: "Script", fallback: SCRIPT },
  { id: "sacramento", family: "Sacramento", category: "Script", fallback: SCRIPT },
  { id: "parisienne", family: "Parisienne", category: "Script", fallback: SCRIPT },
  { id: "italianno", family: "Italianno", category: "Script", fallback: SCRIPT },
  { id: "rouge-script", family: "Rouge Script", category: "Script", fallback: SCRIPT },
  { id: "dancing-script", family: "Dancing Script", category: "Script", fallback: SCRIPT },
  { id: "satisfy", family: "Satisfy", category: "Script", fallback: SCRIPT },
  { id: "cookie", family: "Cookie", category: "Script", fallback: SCRIPT },
  { id: "birthstone", family: "Birthstone", category: "Script", fallback: SCRIPT },
  { id: "imperial-script", family: "Imperial Script", category: "Script", fallback: SCRIPT },
  { id: "ephesis", family: "Ephesis", category: "Script", fallback: SCRIPT },
  { id: "updock", family: "Updock", category: "Script", fallback: SCRIPT },
  { id: "mrs-saint-delafield", family: "Mrs Saint Delafield", category: "Script", fallback: SCRIPT },
  { id: "style-script", family: "Style Script", category: "Script", fallback: SCRIPT },
  { id: "lavishly-yours", family: "Lavishly Yours", category: "Script", fallback: SCRIPT },
  { id: "monsieur-la-doulaise", family: "Monsieur La Doulaise", category: "Script", fallback: SCRIPT },
  { id: "calligraffitti", family: "Calligraffitti", category: "Script", fallback: SCRIPT },
  { id: "arizonia", family: "Arizonia", category: "Script", fallback: SCRIPT },
  { id: "outfit", family: "Outfit", category: "Sans", fallback: SANS },
  { id: "nunito", family: "Nunito", category: "Sans", fallback: SANS },
  { id: "josefin-sans", family: "Josefin Sans", category: "Sans", fallback: SANS },
  { id: "montserrat", family: "Montserrat", category: "Sans", fallback: SANS },
  { id: "raleway", family: "Raleway", category: "Sans", fallback: SANS },
  { id: "jost", family: "Jost", category: "Sans", fallback: SANS },
  { id: "manrope", family: "Manrope", category: "Sans", fallback: SANS },
  { id: "figtree", family: "Figtree", category: "Sans", fallback: SANS },
  { id: "mulish", family: "Mulish", category: "Sans", fallback: SANS },
  { id: "tenor-sans", family: "Tenor Sans", category: "Sans", fallback: SANS },
  { id: "karla", family: "Karla", category: "Sans", fallback: SANS },
  { id: "cinzel-decorative", family: "Cinzel Decorative", category: "Decorative", fallback: SERIF },
  { id: "philosopher", family: "Philosopher", category: "Sans", fallback: SANS },
  { id: "quicksand", family: "Quicksand", category: "Sans", fallback: SANS },
  { id: "cormorant-infant", family: "Cormorant Infant", category: "Serif", fallback: SERIF },
];

export const FONT_ROLES: { id: FontRole; label: string; sample: string }[] = [
  { id: "names", label: "Couple names", sample: "The couple" },
  { id: "ceremonyHead", label: "Ceremony headings", sample: "Next ceremony" },
  { id: "ceremonyBody", label: "Ceremony details", sample: "Time, place, and directions" },
  { id: "headings", label: "Wedding headings", sample: "Section titles" },
  { id: "body", label: "Wedding body text", sample: "Invitation and descriptions" },
];

const byId = new Map(WEDDING_FONTS.map((font) => [font.id, font]));

export function weddingFont(id?: string | null) {
  if (!id) return undefined;
  return byId.get(id);
}

export function sanitizeFonts(input: unknown): WeddingFonts | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const next: WeddingFonts = {};
  for (const role of FONT_ROLES) {
    const id = source[role.id];
    if (typeof id === "string" && byId.has(id)) next[role.id] = id;
  }
  return Object.keys(next).length ? next : undefined;
}

/** Keep a saved choice when an older save never sent fonts. An explicit object replaces them. */
export function fontsFromRemote(current: { fonts?: WeddingFonts } | null | undefined, incoming: { fonts?: WeddingFonts } | null | undefined) {
  if (!incoming || incoming.fonts === undefined) return sanitizeFonts(current?.fonts);
  return sanitizeFonts(incoming.fonts) ?? {};
}

export function fontFamily(id?: string | null) {
  const font = weddingFont(id);
  if (!font) return "";
  return `"${font.family}", ${font.fallback}`;
}

export function fontCssVars(fonts: WeddingFonts | null | undefined): CSSProperties {
  const clean = sanitizeFonts(fonts);
  if (!clean) return {};
  const vars: Record<string, string> = {};
  if (clean.names) vars["--wc-font-names"] = fontFamily(clean.names);
  if (clean.ceremonyHead) vars["--wc-font-ceremony-head"] = fontFamily(clean.ceremonyHead);
  if (clean.ceremonyBody) vars["--wc-font-ceremony-body"] = fontFamily(clean.ceremonyBody);
  if (clean.headings) vars["--wc-font-headings"] = fontFamily(clean.headings);
  if (clean.body) vars["--wc-font-body"] = fontFamily(clean.body);
  return vars as CSSProperties;
}

const linked = new Set<string>();

/** Load only the families asked for. Never the whole catalog. */
export function ensureFonts(ids: Array<string | null | undefined>) {
  if (typeof document === "undefined") return;
  const families: string[] = [];
  for (const id of ids) {
    if (!id || linked.has(id)) continue;
    const font = byId.get(id);
    if (!font) continue;
    linked.add(id);
    families.push(font.family);
  }
  if (!families.length) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.media = "print";
  link.onload = () => {
    link.media = "all";
  };
  const query = families.map((family) => `family=${encodeURIComponent(family)}`).join("&");
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.appendChild(link);
}
