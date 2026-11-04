import { createFileRoute } from "@tanstack/react-router";

function cronGate(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return null;
  return new Response("Unauthorized", { status: 401 });
}

export const Route = createFileRoute("/api/lifecycle")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = cronGate(request);
        if (denied) return denied;
        const { runLifecycle } = await import("@/lib/wedding/lifecycle.server");
        return Response.json(await runLifecycle());
      },
      POST: async ({ request }) => {
        const denied = cronGate(request);
        if (denied) return denied;
        const body = (await request.json().catch(() => null)) as { action?: unknown; reference?: unknown; status?: unknown; secret?: unknown } | null;
        if (body?.action === "settle") {
          const expected = process.env.PAYMENT_WEBHOOK_SECRET;
          const reference = typeof body.reference === "string" ? body.reference.trim() : "";
          if (!expected || body.secret !== expected || !reference) {
            return Response.json(
              { ok: false, error: "Payment confirmation is not configured. Retention was not extended." },
              { status: 501 },
            );
          }
          const { settleRetentionPayment } = await import("@/lib/wedding/lifecycle.server");
          const status = body.status === "paid" ? "paid" : "failed";
          return Response.json(await settleRetentionPayment(reference, status));
        }
        const { runLifecycle } = await import("@/lib/wedding/lifecycle.server");
        return Response.json(await runLifecycle());
      },
    },
  },
});
