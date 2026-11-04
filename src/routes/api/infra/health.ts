import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/infra/health")({
  server: {
    handlers: {
      GET: async () => {
        const { publicInfraHealth } = await import("@/lib/infra/core");
        return Response.json(publicInfraHealth(process.env));
      },
    },
  },
});
