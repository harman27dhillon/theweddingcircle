import { createFileRoute } from "@tanstack/react-router";

function tokenOf(request: Request) {
  return new URL(request.url).searchParams.get("t")?.slice(0, 2000) || "";
}

async function answer(request: Request) {
  const { infraStreamDownload } = await import("@/lib/infra/infra.server");
  return infraStreamDownload(tokenOf(request), request.headers.get("range") || "", request.method, request.headers.get("origin") || "");
}

function options(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers = new Headers({ "cache-control": "private, no-store" });
  if (origin.startsWith("https://")) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, HEAD");
    headers.set("vary", "origin");
  }
  return new Response(null, { status: 204, headers });
}

export const Route = createFileRoute("/api/infra/download")({
  server: {
    handlers: {
      GET: async ({ request }) => answer(request),
      HEAD: async ({ request }) => answer(request),
      OPTIONS: async ({ request }) => options(request),
    },
  },
});
