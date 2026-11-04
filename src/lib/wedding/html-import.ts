export type ImportedImage = {
  id: string;
  url: string;
  sourceUrl: string;
  alt: string;
  width?: number;
  height?: number;
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
]);

export const MAX_HTML_BYTES = 1_500_000;
export const MAX_HTML_REDIRECTS = 3;

export function isPrivateIp(address: string) {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!ip) return true;
  if (ip === "::1" || ip === "0::1" || ip === "0.0.0.0" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (ip.includes(":")) return false;
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function addressesArePublic(addresses: string[]) {
  return addresses.length > 0 && addresses.every((address) => !isPrivateIp(address));
}

export function publicHttpUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isPrivateIp(host)) return null;
  return url;
}

export function bodyTooLarge(bytes: number) {
  return bytes > MAX_HTML_BYTES;
}

export function nextRedirect(currentHref: string, location: string | null, hop: number) {
  if (hop >= MAX_HTML_REDIRECTS) return { ok: false as const, error: "That page redirected too many times." };
  if (!location) return { ok: false as const, error: "That page address is not allowed." };
  let next: URL;
  try {
    next = new URL(location, currentHref);
  } catch {
    return { ok: false as const, error: "That page address is not allowed." };
  }
  if (!publicHttpUrl(next.href)) return { ok: false as const, error: "That page address is not allowed." };
  return { ok: true as const, url: next.href };
}

export function fnvId(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decodeAttr(value: string) {
  return value
    .replace(/&/g, "&")
    .replace(/"/g, "\"")
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function absoluteImage(page: URL, raw: string) {
  const value = decodeAttr(raw).trim();
  if (!value || /^(?:data|blob|javascript):/i.test(value)) return "";
  try {
    const url = new URL(value, page);
    if (!publicHttpUrl(url.href)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function dimension(value: string) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20000) return undefined;
  return parsed;
}

function attr(tag: string, name: string) {
  const found = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeAttr((found?.[1] ?? found?.[2] ?? found?.[3] ?? "").trim());
}

export function extractImages(html: string, pageUrl: string): ImportedImage[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const images: ImportedImage[] = [];
  const seen = new Set<string>();
  const push = (raw: string, alt: string, width?: number, height?: number) => {
    const url = absoluteImage(page, raw);
    if (!url || seen.has(url)) return;
    const tiny = width !== undefined && height !== undefined && width > 0 && height > 0 && (width < 32 || height < 32);
    const tracking = /(?:pixel|spacer|tracking|beacon|analytics|1x1)/i.test(url);
    if (tiny || (tracking && (width === undefined || width < 48))) return;
    seen.add(url);
    const item: ImportedImage = {
      id: fnvId(`${page.href}|${url}`),
      url,
      sourceUrl: page.href,
      alt: alt.replace(/\s+/g, " ").slice(0, 240),
    };
    if (width !== undefined && width >= 32) item.width = width;
    if (height !== undefined && height >= 32) item.height = height;
    images.push(item);
  };
  const source = typeof html === "string" ? html : "";
  const tags = source.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const width = dimension(attr(tag, "width"));
    const height = dimension(attr(tag, "height"));
    const alt = attr(tag, "alt");
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-original") || attr(tag, "data-lazy-src");
    if (src) push(src, alt, width, height);
    const srcset = attr(tag, "srcset") || attr(tag, "data-srcset");
    if (srcset) {
      const candidates = srcset.split(",").map((part) => part.trim().split(/\s+/)[0] || "").filter(Boolean);
      const chosen = candidates[candidates.length - 1];
      if (chosen) push(chosen, alt, width, height);
    }
  }
  const meta = source.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of meta) {
    const property = attr(tag, "property") || attr(tag, "name");
    if (!/^og:image(?::url)?$/i.test(property)) continue;
    const content = attr(tag, "content");
    if (content) push(content, "", undefined, undefined);
  }
  return images.slice(0, 40);
}
