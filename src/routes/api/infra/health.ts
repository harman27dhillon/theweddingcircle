import { createFileRoute } from "@tanstack/react-router";
import { serverEnvironment } from "@/lib/env.server";

export const Route = createFileRoute("/api/infra/health")({
  server: {
    handlers: {
      GET: async () => {
        const { publicInfraHealth } = await import("@/lib/infra/core");
        return Response.json(publicInfraHealth(await serverEnvironment()));
      },
    },
  },
});
