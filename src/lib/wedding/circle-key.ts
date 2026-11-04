const STORAGE = "wc-circle-keys";

function read(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberCircleKey(slug: string, key: string) {
  if (typeof localStorage === "undefined") return;
  const all = read();
  all[slug] = key;
  localStorage.setItem(STORAGE, JSON.stringify(all));
}

export function circleKey(slug: string) {
  return read()[slug] ?? "";
}

export function forgetCircleKey(slug: string) {
  if (typeof localStorage === "undefined") return;
  const all = read();
  delete all[slug];
  localStorage.setItem(STORAGE, JSON.stringify(all));
}

const DELETED = "wc-deleted-slugs";

function readDeleted(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 40);
  } catch {
    return [];
  }
}

/** Slugs whose deletion has been confirmed. Stops a stale sync from creating them again. */
export function deletedSlugList() {
  return readDeleted();
}

export function isDeletedSlug(slug: string) {
  const clean = slug.trim().toLowerCase();
  if (!clean) return false;
  return readDeleted().includes(clean);
}

export function rememberDeletedSlug(slug: string) {
  if (typeof localStorage === "undefined") return;
  const clean = slug.trim().toLowerCase();
  if (!clean || clean === "lila-nico") return;
  const next = [clean, ...readDeleted().filter((item) => item !== clean)].slice(0, 40);
  localStorage.setItem(DELETED, JSON.stringify(next));
}
