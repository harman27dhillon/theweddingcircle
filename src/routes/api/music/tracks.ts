import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/music/tracks")({
  server: {
    handlers: {
      GET: async () => {
        const { listMusicTracks } = await import("@/lib/wedding/music-library.server");
        const body = await listMusicTracks();
        return Response.json(
          {
            ok: body.ok,
            tracks: body.tracks.map((track) => ({ id: track.id, title: track.title, src: track.src })),
            ...(body.ok ? {} : { error: body.error }),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
