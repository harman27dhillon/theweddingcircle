/**
 * A missing /assets file must not fall through to the application HTML shell.
 * That shell was being stored with a long cache lifetime and then executed as CSS/JS.
 */
import { rewriteMissingAsset } from "../../scripts/asset-miss.mjs";

interface AssetEvent {
  url: URL;
  req: { method: string };
}

export default async function assetMissMiddleware(
  event: AssetEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  const pathname = event.url.pathname;
  if (!pathname.startsWith("/assets/")) return next();
  const result = await next();
  if (!(result instanceof Response)) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const decision = rewriteMissingAsset({
    pathname,
    status: result.status,
    contentType: result.headers.get("content-type") || "",
  });
  if (!decision) return result;
  return new Response(method === "HEAD" ? null : decision.body, {
    status: decision.status,
    headers: { "content-type": decision.contentType, "cache-control": decision.cacheControl },
  });
}
