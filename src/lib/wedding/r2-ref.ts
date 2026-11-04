const OBJECT_KEY = /^weddings\/[a-z0-9-]{3,80}\/(album|chat|profile|cover)\/[a-z0-9][a-z0-9.-]{0,140}$/;

/** A stored object key. Never a public bucket URL and never a secret. */
export function parseR2Ref(src: string) {
  if (!src.startsWith("r2:")) return null;
  const key = src.slice(3);
  if (key.length > 220 || key.includes("..") || key.includes("\\") || key.includes("//") || key.startsWith("/")) return null;
  if (!OBJECT_KEY.test(key)) return null;
  return key;
}

export function r2Ref(objectKey: string) {
  return `r2:${objectKey}`;
}

export function weddingSlugFromR2Key(objectKey: string) {
  const slug = objectKey.split("/")[1] || "";
  return /^[a-z0-9-]{3,80}$/.test(slug) ? slug : "";
}

export function r2RefBelongsTo(src: string, slug: string) {
  const key = parseR2Ref(src);
  if (!key) return false;
  const wedding = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  return Boolean(wedding) && key.startsWith(`weddings/${wedding}/`);
}

/** Feed preview next to a stored object. Empty when the parent key is not a wedding object. */
export function thumbObjectKey(objectKey: string) {
  if (!parseR2Ref(`r2:${objectKey}`)) return "";
  const next = `${objectKey}.t.webp`;
  return parseR2Ref(`r2:${next}`) ? next : "";
}
