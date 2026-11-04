/* App-shell worker. Keep in step with shellRequestPolicy in src/lib/wedding/offline.ts.
   Firebase messaging keeps its own narrow scope and is not controlled here.
   Bump VERSION when this file or offline.html changes so old shell caches drop. */
const VERSION = "v8";
const PRECACHE = "wc-precache-" + VERSION;
const ASSETS = "wc-assets-" + VERSION;
const UI = "wc-ui-" + VERSION;
const DOCS = "wc-docs-" + VERSION;
const OURS = [PRECACHE, ASSETS, UI, DOCS];
const PRECACHE_URLS = ["/favicon.svg", "/who-said-trophy.png", "/__grok/icon-180.png"];
const UI_LIMIT = 40;
const ASSET_LIMIT = 24;
const DOC_LIMIT = 8;
const UI_BYTES = 500000;
const ASSET_BYTES = 1500000;
const DOC_BYTES = 700000;

function policy(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return "bypass";
  const path = (pathname || "/").split("?")[0] || "/";
  if (path.includes("..")) return "bypass";
  if (path === "/wedding-shell-sw.js" || path === "/firebase-messaging-sw.js") return "bypass";
  const priv = ["/api", "/_server", "/auth", "/src/", "/@", "/node_modules/", "/.vite", "/__vite"];
  if (priv.some((item) => path === item || path.startsWith(item))) return "bypass";
  if (/\.(?:mp4|webm|mov|m4v|m3u8|ts|wav|mp3|ogg|aac)$/i.test(path)) return "bypass";
  if (path.startsWith("/media/") || path.startsWith("/theme-music/")) return "bypass";
  if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(path)) return "immutable";
  if (/\.(?:js|mjs|css)$/i.test(path) && path.startsWith("/assets/")) return "fresh";
  if (/\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|ico)$/i.test(path)) {
    if (path.startsWith("/assets/") || path === "/favicon.svg" || path === "/og.jpg" || path === "/who-said-trophy.png" || ["/card-themes/", "/covers/", "/flora/", "/__grok/"].some((item) => path.startsWith(item))) return "static";
    return "bypass";
  }
  return "navigate";
}

async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

function privateDocument(text) {
  const sample = String(text || "").slice(0, 12000).toLowerCase();
  return sample.includes("access_token") || sample.includes("refresh_token") || sample.includes("service_role") || sample.includes("authorization: bearer");
}

async function rememberDocument(request, response) {
  try {
    if (!response || !response.ok || response.type !== "basic" || response.redirected) return;
    if (response.headers.has("set-cookie")) return;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html")) return;
    const text = await response.clone().text();
    if (!text || text.length > DOC_BYTES || privateDocument(text) || !text.toLowerCase().includes("wc-shell-" + VERSION)) return;
    const cache = await caches.open(DOCS);
    await cache.put(request, new Response(text, {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    }));
    await trim(cache, DOC_LIMIT);
  } catch {
    /* A full cache must not break the page. */
  }
}
function assetOk(response) {
  if (!response || response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  if (response.headers.has("set-cookie")) return false;
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (!type || type.includes("text/html")) return false;
  return type.includes("javascript") || type.includes("ecmascript") || type.includes("text/css") || type.includes("image/") || type.includes("font/") || type.includes("application/json") || type.includes("wasm");
}

function assetMiss() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function htmlResponse(response) {
  return ((response && response.headers.get("content-type")) || "").toLowerCase().includes("text/html");
}

function deliverAsset(fresh, cached) {
  if (htmlResponse(fresh)) return cached && assetOk(cached) ? cached : assetMiss();
  if (fresh.status !== 200) {
    if (cached && assetOk(cached)) return cached;
    const headers = new Headers({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return new Response(fresh.status === 404 ? "Not found" : "Unavailable", { status: fresh.status === 404 ? 404 : fresh.status, headers });
  }
  return fresh;
}

function fromNetwork(request) {
  return fetch(request, { cache: "reload" });
}

async function putSafe(name, request, response, limit, maxBytes) {
  try {
    if (!assetOk(response)) return;
    const body = await response.clone().blob();
    if (!body.size || body.size > maxBytes) return;
    const type = response.headers.get("content-type") || "application/octet-stream";
    if (type.toLowerCase().includes("text/html")) return;
    const cache = await caches.open(name);
    await cache.put(request, new Response(body, { headers: { "content-type": type }, status: 200 }));
    await trim(cache, limit);
  } catch {
    /* A full cache must not break the page. */
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok && response.type === "basic" && !response.headers.has("set-cookie")) await cache.put(url, response);
      } catch {
        /* A missing shell file must not block the worker. */
      }
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith("wc-precache-") || key.startsWith("wc-assets-") || key.startsWith("wc-ui-") || key.startsWith("wc-docs-") || key.startsWith("wc-shell-") || key.startsWith("wc-doc-")) && !OURS.includes(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim()).then(() => self.clients.matchAll({ type: "window" })).then((clients) => {
      for (const client of clients) client.postMessage({ type: "WC_SHELL", version: VERSION });
    }),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  if (type === "DROP_PRIVATE") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("wc-shell-") || key.startsWith("wc-doc-")).map((key) => caches.delete(key)))));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.headers.has("range")) return;
  if (request.destination === "audio" || request.destination === "video") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const kind = policy(request.method, url.pathname);
  if (kind === "bypass") return;
  if (kind === "navigate") {
    if (request.mode !== "navigate") return;
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: "reload" });
        void rememberDocument(request, fresh);
        return fresh;
      } catch {
        const docs = await caches.open(DOCS);
        const exact = await docs.match(request);
        if (exact) return exact;
        return (await caches.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }
  if (kind === "immutable" || kind === "fresh") {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      if (kind === "immutable") {
        const hit = await cache.match(request);
        if (hit && assetOk(hit)) return hit;
        if (hit) await cache.delete(request);
      }
      try {
        const fresh = await fromNetwork(request);
        if (assetOk(fresh)) void putSafe(ASSETS, request, fresh.clone(), ASSET_LIMIT, ASSET_BYTES);
        const cached = await cache.match(request);
        return deliverAsset(fresh, cached && assetOk(cached) ? cached : undefined);
      } catch {
        const cached = await cache.match(request);
        if (cached && assetOk(cached)) return cached;
        return Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(UI);
    try {
      const fresh = await fromNetwork(request);
      if (assetOk(fresh)) void putSafe(UI, request, fresh.clone(), UI_LIMIT, UI_BYTES);
      const cached = await cache.match(request);
      return deliverAsset(fresh, cached && assetOk(cached) ? cached : undefined);
    } catch {
      const cached = await cache.match(request);
      if (cached && assetOk(cached)) return cached;
      return Response.error();
    }
  })());
});
