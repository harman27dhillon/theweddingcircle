import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/chunk")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          { ok: false, error: "New photos and videos are saved in private wedding storage, not Google Drive." },
          { status: 410, headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
