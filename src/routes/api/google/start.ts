import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/start")({
  server: {
    handlers: {
      GET: async () =>
        new Response("Google Drive is no longer used for wedding media. Nothing was connected.", {
          status: 410,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        }),
    },
  },
});
