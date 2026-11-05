import { createServerFn } from "@tanstack/react-start";
import type { LiveAction } from "@/lib/infra/live";
import type { MediaPurpose } from "@/lib/infra/media-policy";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const PURPOSES = new Set<MediaPurpose>(["album", "chat", "profile", "cover"]);
const ACTIONS = new Set<LiveAction>(["create", "start", "stop", "watch", "status"]);

export const infraPrepareUpload = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; purpose?: unknown; mime?: unknown; bytes?: unknown; fileName?: unknown };
    const purpose = text(body?.purpose, 20);
    const bytes = typeof body?.bytes === "number" ? body.bytes : Number.NaN;
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      purpose: PURPOSES.has(purpose as MediaPurpose) ? purpose as MediaPurpose : "album" as const,
      mime: text(body?.mime, 80).toLowerCase(),
      bytes: Number.isFinite(bytes) ? Math.min(Math.max(0, Math.floor(bytes)), 200_000_000) : 0,
      fileName: text(body?.fileName, 120) || "file",
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    const { infraPrepareUpload: prepare } = await import("@/lib/infra/infra.server");
    return prepare(data);
  });

export const infraConfirmUpload = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; objectKey?: unknown; purpose?: unknown; mime?: unknown; bytes?: unknown };
    const purpose = text(body?.purpose, 20);
    const bytes = typeof body?.bytes === "number" ? body.bytes : Number.NaN;
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      objectKey: text(body?.objectKey, 240),
      purpose: PURPOSES.has(purpose as MediaPurpose) ? purpose as MediaPurpose : "album" as const,
      mime: text(body?.mime, 80).toLowerCase(),
      bytes: Number.isFinite(bytes) ? Math.min(Math.max(0, Math.floor(bytes)), 200_000_000) : 0,
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    const { infraConfirmUpload: confirm } = await import("@/lib/infra/infra.server");
    return confirm(data);
  });

export const infraAcceptChunk = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as {
      slug?: unknown;
      memberKey?: unknown;
      purpose?: unknown;
      mime?: unknown;
      fileName?: unknown;
      uploadId?: unknown;
      index?: unknown;
      totalChunks?: unknown;
      totalBytes?: unknown;
      chunk?: unknown;
    };
    const purpose = text(body?.purpose, 20);
    const index = typeof body?.index === "number" ? body.index : Number.NaN;
    const totalChunks = typeof body?.totalChunks === "number" ? body.totalChunks : Number.NaN;
    const totalBytes = typeof body?.totalBytes === "number" ? body.totalBytes : Number.NaN;
    const chunk = typeof body?.chunk === "string" ? body.chunk : "";
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      purpose: PURPOSES.has(purpose as MediaPurpose) ? purpose as MediaPurpose : "album" as const,
      mime: text(body?.mime, 80).toLowerCase(),
      fileName: text(body?.fileName, 120) || "file",
      uploadId: text(body?.uploadId, 40).toLowerCase(),
      index: Number.isFinite(index) ? Math.floor(index) : -1,
      totalChunks: Number.isFinite(totalChunks) ? Math.floor(totalChunks) : 0,
      totalBytes: Number.isFinite(totalBytes) ? Math.min(Math.max(0, Math.floor(totalBytes)), 200_000_000) : 0,
      chunk: /^[A-Za-z0-9+/]+={0,2}$/.test(chunk) && chunk.length <= 1_200_000 ? chunk : "",
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    if (data.uploadId && !/^[a-f0-9]{32}$/.test(data.uploadId)) return { ok: false as const, error: "That upload does not belong to this wedding." };
    if (!data.chunk) return { ok: false as const, error: "That upload piece was empty. Nothing was stored." };
    const { infraAcceptChunk: accept } = await import("@/lib/infra/infra.server");
    return accept(data);
  });

export const infraPrepareDownload = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; objectKey?: unknown; variant?: unknown };
    const variant = text(body?.variant, 20);
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      objectKey: text(body?.objectKey, 240),
      variant: variant === "preview" ? "preview" as const : "full" as const,
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    const { infraPrepareDownload: prepare } = await import("@/lib/infra/infra.server");
    return prepare(data);
  });

export const infraDropUnrecorded = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; objectKey?: unknown };
    return { slug: text(body?.slug, 80).toLowerCase(), memberKey: text(body?.memberKey, 80), objectKey: text(body?.objectKey, 240) };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    const { infraDropUnrecorded: drop } = await import("@/lib/infra/infra.server");
    return drop(data);
  });

export const infraStoreThumb = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; objectKey?: unknown; mime?: unknown; bytes?: unknown; chunk?: unknown };
    const bytes = typeof body?.bytes === "number" ? body.bytes : Number.NaN;
    const chunk = typeof body?.chunk === "string" ? body.chunk : "";
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      objectKey: text(body?.objectKey, 240),
      mime: text(body?.mime, 80).toLowerCase(),
      bytes: Number.isFinite(bytes) ? Math.min(Math.max(0, Math.floor(bytes)), 400_000) : 0,
      chunk: /^[A-Za-z0-9+/]+={0,2}$/.test(chunk) && chunk.length <= 600_000 ? chunk : "",
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey) || !data.chunk) {
      return { ok: false as const, error: "That preview was not stored." };
    }
    const { infraStoreThumb: store } = await import("@/lib/infra/infra.server");
    return store({ slug: data.slug, memberKey: data.memberKey, objectKey: data.objectKey, mime: data.mime, bytes: data.bytes, chunk: data.chunk });
  });

export const infraIssueDownload = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; objectKey?: unknown; name?: unknown };
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      objectKey: text(body?.objectKey, 240),
      name: text(body?.name, 80),
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "You are not in this wedding." };
    }
    const { infraIssueDownload: issue } = await import("@/lib/infra/infra.server");
    return issue(data);
  });

export const infraLivePlan = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; memberKey?: unknown; action?: unknown };
    const action = text(body?.action, 20);
    return {
      slug: text(body?.slug, 80).toLowerCase(),
      memberKey: text(body?.memberKey, 80),
      action: ACTIONS.has(action as LiveAction) ? action as LiveAction : "status" as const,
    };
  })
  .handler(async ({ data }) => {
    if (!/^[a-z0-9-]{3,80}$/.test(data.slug) || !/^[A-Za-z0-9_-]{8,80}$/.test(data.memberKey)) {
      return { ok: false as const, error: "This livestream is private to the wedding." };
    }
    const { infraLivePlan: plan } = await import("@/lib/infra/infra.server");
    return plan(data);
  });

export const infraVerifyPurchase = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slot?: unknown; purchaseToken?: unknown };
    return { slot: text(body?.slot, 40), purchaseToken: text(body?.purchaseToken, 500) };
  })
  .handler(async ({ data }) => {
    const { infraVerifyPurchase: verify } = await import("@/lib/infra/infra.server");
    return verify(data);
  });

