export const LIBRARY_CATEGORIES = ["Wedding covers", "Backgrounds", "Invitations", "Sample art"] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export type BuiltinAsset = {
  id: string;
  name: string;
  category: LibraryCategory;
  path: string;
  places: string[];
};

/** Pictures already shipped with the app. The library seeds these; it does not delete the files. */
export const BUILTIN_ASSETS: BuiltinAsset[] = [
  { id: "cover", name: "The hall", category: "Wedding covers", path: "/media/cover.webp", places: ["Cover picker"] },
  { id: "ceremony", name: "The ceremony", category: "Wedding covers", path: "/media/ceremony.webp", places: ["Cover picker"] },
  { id: "mehndi", name: "The garden", category: "Wedding covers", path: "/media/mehndi.webp", places: ["Cover picker", "Home page"] },
  { id: "baraat", name: "The arrival", category: "Wedding covers", path: "/media/baraat.webp", places: ["Cover picker"] },
  { id: "city", name: "The city", category: "Wedding covers", path: "/media/city.webp", places: ["Cover picker"] },
  { id: "hall", name: "The porch", category: "Wedding covers", path: "/media/hall.webp", places: ["Cover picker", "Services"] },
  { id: "flowers", name: "Flowers", category: "Wedding covers", path: "/media/theme-flowers.webp", places: ["Cover picker", "Home page"] },
  { id: "lights", name: "Lights", category: "Wedding covers", path: "/media/theme-lights.webp", places: ["Cover picker", "Home page"] },
  { id: "aisle", name: "The aisle", category: "Wedding covers", path: "/media/theme-aisle.webp", places: ["Cover picker"] },
  { id: "table", name: "The table", category: "Wedding covers", path: "/media/theme-table.webp", places: ["Cover picker"] },
  { id: "demo-hall", name: "Sample hall", category: "Sample art", path: "/media/demo-hall.svg", places: ["Sample wedding"] },
  { id: "demo-dinner", name: "Sample dinner", category: "Sample art", path: "/media/demo-dinner.svg", places: ["Sample wedding"] },
  { id: "demo-dance", name: "Sample dance", category: "Sample art", path: "/media/demo-dance.svg", places: ["Sample wedding"] },
];

export function isLibraryCategory(value: string): value is LibraryCategory {
  return (LIBRARY_CATEGORIES as readonly string[]).includes(value);
}

export function builtinById(id: string) {
  return BUILTIN_ASSETS.find((item) => item.id === id) ?? null;
}
