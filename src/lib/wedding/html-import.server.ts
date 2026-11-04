import { lookup } from "node:dns/promises";
import {
  addressesArePublic,
  bodyTooLarge,
  extractImages,
  nextRedirect,
  publicHttpUrl,
  type ImportedImage,
} from "./html-import.ts";

type ImportResult =
  | { ok: true; sourceUrl: string; images: ImportedImage[] }
  | { ok: false; error: string };

const TIMEOUT_MS = 8000;
const CACHE_MS = 5 * 60 * 1000;
const hostHits = new Map<string, number[]>();
const globalHits: number[] = [];
const cache = new Map<string, { at: number; body: ImportResult }>();

function recent(list: number[], now: number) {
  return list.filter((stamp) => now - stamp < 60_000);
}

function allowRequest(host: string) {
  const now = Date.now();
  const own = recent(hostHits.get(host) ?? [], now);
  const all = recent(globalHits, now);
  if (own.length >= 12 || all.length >= 40) return false;
  own.push(now);
  all.push(now);
  hostHits.set(host, own);
  globalHits.length = 0;
  globalHits.push(...all);
  return true;
}

async function hostAllowed(url: URL) {
  if (!publicHttpUrl(url.href)) return false;
  try {
    const records = await lookup(url.hostname, { all: true });
    return addressesArePublic(records.map((record) => record.address));
  } catch {
    return false;
  }
}

async function readCapped(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && bodyTooLarge(declared)) return null;
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (bodyTooLarge(total)) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(step.value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function htmlResponse(response: Response, html: string) {
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml+xml")) return true;
  if (type && !type.includes("text/plain")) return false;
  return /^\s*</.test(html.slice(0, 400));
}

export async function importHtmlImages(rawUrl: string): Promise<ImportResult> {
  const start = publicHttpUrl(rawUrl);
  if (!start) return { ok: false, error: "That page address is not allowed." };
  const cached = cache.get(start.href);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
  if (!allowRequest(start.hostname)) return { ok: false, error: "Too many import requests. Try again in a minute." };
  let current = start;
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!(await hostAllowed(current))) return { ok: false, error: "That page address is not allowed." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "WeddingCircleHtmlImport/1.0",
        },
      });
    } catch {
      return { ok: false, error: "That page could not be reached." };
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = nextRedirect(current.href, response.headers.get("location"), hop);
      if (!next.ok) return next;
      current = new URL(next.url);
      continue;
    }
    if (!response.ok) return { ok: false, error: "That page could not be read." };
    const html = await readCapped(response);
    if (html === null) return { ok: false, error: "That page is larger than the import limit." };
    if (!htmlResponse(response, html)) return { ok: false, error: "That page is not an HTML document." };
    const body: ImportResult = { ok: true, sourceUrl: current.href, images: extractImages(html, current.href) };
    cache.set(start.href, { at: Date.now(), body });
    return body;
  }
  return { ok: false, error: "That page redirected too many times." };
}
