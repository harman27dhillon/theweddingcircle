import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { openDriveFile } = await import("@/lib/google/photos.server");
        return openDriveFile(request);
      },
    },
  },
});
