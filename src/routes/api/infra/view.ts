import { createFileRoute } from "@tanstack/react-router";

function tokenOf(request: Request) {
  return new URL(request.url).searchParams.get("t")?.slice(0, 2000) || "";
}

export const Route = createFileRoute("/api/infra/view")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { infraStreamView } = await import("@/lib/infra/infra.server");
        return infraStreamView(tokenOf(request), request.headers.get("range") || "", request.method, request.headers.get("origin") || "");
      },
      HEAD: async ({ request }) => {
        const { infraStreamView } = await import("@/lib/infra/infra.server");
        return infraStreamView(tokenOf(request), request.headers.get("range") || "", request.method, request.headers.get("origin") || "");
      },
    },
  },
});
