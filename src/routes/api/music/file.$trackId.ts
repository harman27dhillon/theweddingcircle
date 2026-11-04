import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/music/file/$trackId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { readMusicFile } = await import("@/lib/wedding/music-library.server");
        const file = await readMusicFile(params.trackId);
        if (!file) return new Response("Not found", { status: 404 });
        const versioned = new URL(request.url).searchParams.has("v");
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "content-type": file.mime,
            "cache-control": versioned ? "public, max-age=86400" : "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
