/** Missing /assets responses must be a real 404, never the HTML shell. */
// @ts-nocheck

const ASSET_EXT = /\.(?:js|mjs|css|map|json|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|wasm)$/i;

export function rewriteMissingAsset(input) {
  const pathname = String(input?.pathname || "");
  if (!pathname.startsWith("/assets/")) return null;
  const type = String(input?.contentType || "").toLowerCase();
  const status = Number(input?.status || 0);
  if (type.includes("text/html")) return miss();
  if (status === 200 && (type || ASSET_EXT.test(pathname))) return null;
  if (status === 200 && type && !type.includes("text/html")) return null;
  return miss();
}

function miss() {
  return {
    status: 404,
    body: "Not found",
    contentType: "text/plain; charset=utf-8",
    cacheControl: "no-store",
  };
}

export function assetCacheable(status, contentType, setCookie = false) {
  if (status !== 200 || setCookie) return false;
  const type = String(contentType || "").toLowerCase();
  if (!type || type.includes("text/html")) return false;
  return (
    type.includes("javascript") ||
    type.includes("ecmascript") ||
    type.includes("text/css") ||
    type.includes("image/") ||
    type.includes("font/") ||
    type.includes("application/json") ||
    type.includes("wasm")
  );
}
