import { openCircleMedia, releaseCircleMedia } from "@/lib/google/photos.functions";

export function parseGoogleRef(src: string) {
  if (!src.startsWith("gp:")) return null;
  const rest = src.slice(3);
  const slash = rest.indexOf("/");
  if (slash < 1) return null;
  return { slug: decodeURIComponent(rest.slice(0, slash)), id: rest.slice(slash + 1) };
}

export async function uploadToGoogle(_file?: File, _slug?: string, _onStatus?: (label: string) => void) {
  throw new Error("New photos and videos are saved in private wedding storage, not Google Drive.");
}

const fresh = new Map<string, { url: string; until: number }>();

export async function resolveGoogleMedia(src: string, intent: "view" | "download" = "view") {
  const parsed = parseGoogleRef(src);
  if (!parsed) return { url: "", note: "" };
  const key = `${intent}:${parsed.slug}/${parsed.id}`;
  const cached = fresh.get(key);
  if (intent === "view" && cached && cached.until > Date.now()) return { url: cached.url, note: "" };
  const result = await openCircleMedia({ data: { ...parsed, intent } });
  if (!result.ok) return { url: "", note: result.error };
  if (result.pending || !result.url) return { url: "", note: "Google Drive is still preparing this file. It stays in the uploader's Drive." };
  if (intent === "view") fresh.set(key, { url: result.url, until: Date.now() + 45 * 60 * 1000 });
  return { url: result.url, note: "" };
}

export async function releaseGoogleMedia(src: string) {
  const parsed = parseGoogleRef(src);
  if (!parsed) return;
  await releaseCircleMedia({ data: parsed });
}
