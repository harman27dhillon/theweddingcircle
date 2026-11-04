export type LivingCategory = "Elegant" | "Romantic" | "Indian wedding" | "Nature" | "Modern";
export type PageMotion = "static" | "subtle" | "motion";
export type BitKind = "petal" | "heart" | "dot" | "leaf" | "drop" | "star" | "ring" | "square";

export type LivingStyle = {
  id: string;
  name: string;
  category: LivingCategory;
  animated: boolean;
  dark?: boolean;
  drift?: boolean;
  bits?: BitKind;
};

export const LIVING_CATEGORIES: LivingCategory[] = ["Elegant", "Romantic", "Indian wedding", "Nature", "Modern"];

export const LIVING_STYLES: LivingStyle[] = [
  { id: "classic", name: "As it is now", category: "Elegant", animated: false },
  { id: "ivory", name: "Ivory", category: "Elegant", animated: false },
  { id: "champagne", name: "Champagne", category: "Elegant", animated: false },
  { id: "pearl", name: "Pearl", category: "Elegant", animated: false },
  { id: "silk", name: "Soft silk", category: "Elegant", animated: true, drift: true },
  { id: "marble", name: "Subtle marble", category: "Elegant", animated: false },
  { id: "cream", name: "Warm cream", category: "Elegant", animated: false },
  { id: "blush", name: "Blush gradient", category: "Romantic", animated: true, drift: true },
  { id: "petals", name: "Floating rose petals", category: "Romantic", animated: true, bits: "petal" },
  { id: "bokeh", name: "Soft bokeh", category: "Romantic", animated: true, bits: "dot" },
  { id: "hearts", name: "Floating hearts", category: "Romantic", animated: true, bits: "heart" },
  { id: "rosegold", name: "Rose-gold particles", category: "Romantic", animated: true, bits: "dot" },
  { id: "pink", name: "Romantic pink", category: "Romantic", animated: true, drift: true },
  { id: "mehndi", name: "Subtle mehndi", category: "Indian wedding", animated: false },
  { id: "mandala", name: "Gold mandala", category: "Indian wedding", animated: true, bits: "dot" },
  { id: "phulkari", name: "Phulkari", category: "Indian wedding", animated: false },
  { id: "marigold", name: "Marigold petals", category: "Indian wedding", animated: true, bits: "petal" },
  { id: "textile", name: "Indian textile", category: "Indian wedding", animated: false },
  { id: "paisley", name: "Subtle paisley", category: "Indian wedding", animated: false },
  { id: "leaves", name: "Floating leaves", category: "Nature", animated: true, bits: "leaf" },
  { id: "blossom", name: "Falling petals", category: "Nature", animated: true, bits: "petal" },
  { id: "clouds", name: "Gentle clouds", category: "Nature", animated: true, drift: true },
  { id: "rain", name: "Soft rain", category: "Nature", animated: true, bits: "drop" },
  { id: "fireflies", name: "Fireflies", category: "Nature", animated: true, bits: "star", dark: true },
  { id: "garden", name: "Spring garden", category: "Nature", animated: true, bits: "leaf" },
  { id: "aurora", name: "Aurora", category: "Modern", animated: true, drift: true },
  { id: "mesh", name: "Mesh gradient", category: "Modern", animated: true, drift: true },
  { id: "glass", name: "Glass circles", category: "Modern", animated: true, bits: "ring" },
  { id: "geo", name: "Geometric motion", category: "Modern", animated: true, bits: "square" },
  { id: "field", name: "Soft particles", category: "Modern", animated: true, bits: "dot" },
  { id: "starry", name: "Dark starry", category: "Modern", animated: true, bits: "star", dark: true },
];

export const LIVING_BY_ID: Record<string, LivingStyle> = Object.fromEntries(LIVING_STYLES.map((style) => [style.id, style]));

export function livingStyle(id: string | undefined) {
  return LIVING_BY_ID[id ?? "classic"] ?? LIVING_STYLES[0];
}
