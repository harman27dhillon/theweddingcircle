import { handleMediaGateway, readMediaEdgeCache, type MediaHead } from "../../../src/lib/infra/media-gateway.ts";

type R2Range = { offset: number; length: number };

type StoredObject = {
  size: number;
  etag: string;
  httpEtag?: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  body?: ReadableStream<Uint8Array> | null;
};

type PrivateBucket = {
  get(key: string, options?: { range?: R2Range }): Promise<StoredObject | null>;
  head(key: string): Promise<StoredObject | null>;
};

export interface Env {
  MEDIA: PrivateBucket;
  MEDIA_GATEWAY_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  MEDIA_EDGE_CACHE?: string;
}

function adapt(object: StoredObject | null): MediaHead | null {
  if (!object) return null;
  return {
    size: object.size,
    etag: object.httpEtag || object.etag,
    uploaded: object.uploaded,
    contentType: object.httpMetadata?.contentType || "",
    body: object.body ?? null,
  };
}

export default {
  async fetch(request: Request, env: Env) {
    if (!env?.MEDIA) {
      return new Response(JSON.stringify({ ok: false, error: "That file could not be opened." }), {
        status: 503,
        headers: { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" },
      });
    }
    const edge = readMediaEdgeCache(env.MEDIA_EDGE_CACHE);
    return handleMediaGateway(request, {
      secret: env.MEDIA_GATEWAY_SECRET || "",
      allowedOrigins: env.ALLOWED_ORIGINS || "",
      head: async (key) => adapt(await env.MEDIA.head(key)),
      get: async (key, range) => adapt(await env.MEDIA.get(key, range ? { range } : undefined)),
      cachePolicy: edge ? "authorized" : undefined,
      edgeCache: edge && typeof caches !== "undefined" ? {
        match: (candidate: Request) => caches.default.match(candidate),
        put: (candidate: Request, response: Response) => caches.default.put(candidate, response),
      } : undefined,
    });
  },
};
