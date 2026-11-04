import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/realtime/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = new Uint8Array(await request.arrayBuffer());
        const { acceptRealtimeWebhook } = await import("@/lib/infra/realtime.server");
        const result = await acceptRealtimeWebhook(
          raw,
          request.headers.get("rtk-signature") || "",
          request.headers.get("rtk-uuid") || "",
        );
        if (result.status !== 200) {
          return Response.json({ ok: false, error: "error" in result ? result.error : "The webhook was rejected." }, { status: result.status, headers: { "cache-control": "no-store" } });
        }
        return Response.json({ ok: true }, { status: 200, headers: { "cache-control": "no-store" } });
      },
    },
  },
});
