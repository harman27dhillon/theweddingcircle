import { createFileRoute } from "@tanstack/react-router";
import { redactDetail } from "@/lib/infra/core";
import { UPLOAD_CHUNK_BYTES } from "@/lib/infra/r2-browser";
import type { MediaPurpose } from "@/lib/infra/media-policy";

const PURPOSES = new Set<MediaPurpose>(["album", "chat", "profile", "cover"]);

function denied(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

function header(request: Request, name: string, max: number) {
  return (request.headers.get(name) || "").trim().slice(0, max);
}

async function readPiece(request: Request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > UPLOAD_CHUNK_BYTES) return { error: "That upload piece is too large. Nothing was stored." };
  if (!request.body) return { error: "That upload piece was empty. Nothing was stored." };
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > UPLOAD_CHUNK_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { error: "That upload piece is too large. Nothing was stored." };
    }
    parts.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return { body };
}

export const Route = createFileRoute("/api/infra/media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const purpose = header(request, "x-wc-purpose", 20);
          const index = Number(header(request, "x-wc-index", 12));
          const totalChunks = Number(header(request, "x-wc-total", 12));
          const totalBytes = Number(header(request, "x-wc-bytes", 12));
          const uploadId = header(request, "x-wc-upload", 40).toLowerCase();
          const slug = header(request, "x-wc-slug", 80).toLowerCase();
          const memberKey = header(request, "x-wc-member", 80);
          if (!/^[a-z0-9-]{3,80}$/.test(slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(memberKey)) return denied("You are not in this wedding.", 403);
          if (!PURPOSES.has(purpose as MediaPurpose)) return denied("That upload is not allowed.");
          if (uploadId && !/^[a-f0-9]{32}$/.test(uploadId)) return denied("That upload does not belong to this wedding.");
          const piece = await readPiece(request);
          if ("error" in piece) return denied(piece.error || "That upload piece was empty. Nothing was stored.");
          if (!piece.body.byteLength) return denied("That upload piece was empty. Nothing was stored.");
          const { infraAcceptChunk } = await import("@/lib/infra/infra.server");
          const result = await infraAcceptChunk({
            slug,
            memberKey,
            purpose: purpose as MediaPurpose,
            mime: header(request, "x-wc-mime", 80).toLowerCase(),
            fileName: header(request, "x-wc-name", 120) || "file",
            uploadId,
            index: Number.isFinite(index) ? Math.floor(index) : -1,
            totalChunks: Number.isFinite(totalChunks) ? Math.floor(totalChunks) : 0,
            totalBytes: Number.isFinite(totalBytes) ? Math.min(Math.max(0, Math.floor(totalBytes)), 200_000_000) : 0,
            chunk: Buffer.from(piece.body).toString("base64"),
          });
          if (!result.ok) console.error("[media-upload]", result.error);
          return Response.json(result, { status: result.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
        } catch (error) {
          const detail = redactDetail(error instanceof Error ? error.message : "The upload could not be saved.");
          console.error("[media-upload]", detail || "The app server failed before Cloudflare R2 returned a result.");
          return denied(detail || "The app server failed before Cloudflare R2 returned a result. Nothing was stored.");
        }
      },
    },
  },
});
