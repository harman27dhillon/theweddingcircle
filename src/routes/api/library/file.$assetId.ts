import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/library/file/$assetId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { readLibraryFile } = await import("@/lib/wedding/library.server");
        const file = await readLibraryFile(params.assetId);
        if (!file) return new Response("Not found", { status: 404 });
        const versioned = new URL(request.url).searchParams.has("v");
        const cache =
          params.assetId === "sample-cover"
            ? versioned
              ? "public, max-age=31536000, immutable"
              : "no-store"
            : "public, max-age=86400";
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "content-type": file.mime,
            "cache-control": cache,
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
