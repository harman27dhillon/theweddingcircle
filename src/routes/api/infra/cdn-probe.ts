import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/infra/cdn-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { cdnProbeResponse } = await import("@/lib/infra/infra.server");
        return cdnProbeResponse(request.headers.get("x-wc-cdn-probe") || "");
      },
    },
  },
});
