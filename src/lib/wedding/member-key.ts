const STORAGE = "wc-member-keys";
const ENTRY = "wc-entry-codes";

function read(storageKey: string): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function write(storageKey: string, slug: string, value: string) {
  if (typeof localStorage === "undefined" || !value) return;
  const all = read(storageKey);
  all[slug.trim().toLowerCase()] = value;
  localStorage.setItem(storageKey, JSON.stringify(all));
}

function forget(storageKey: string, slug: string) {
  if (typeof localStorage === "undefined") return;
  const all = read(storageKey);
  delete all[slug.trim().toLowerCase()];
  localStorage.setItem(storageKey, JSON.stringify(all));
}

export function memberKeyFor(slug: string) {
  return read(STORAGE)[slug.trim().toLowerCase()] ?? "";
}

export function memberKeyList() {
  return Object.values(read(STORAGE)).filter((key) => /^[A-Za-z0-9_-]{8,80}$/.test(key)).slice(0, 30);
}

export function rememberMemberKey(slug: string, key: string) {
  write(STORAGE, slug, key);
}

export function forgetMemberKey(slug: string) {
  forget(STORAGE, slug);
}

export function entryCodeFor(slug: string) {
  return read(ENTRY)[slug.trim().toLowerCase()] ?? "";
}

export function rememberEntryCode(slug: string, code: string) {
  write(ENTRY, slug, code.trim());
}

export function forgetEntryCode(slug: string) {
  forget(ENTRY, slug);
}
