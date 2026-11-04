import { createServerFn } from "@tanstack/react-start";

function linkOf(input: unknown) {
  const body = input as { link?: unknown };
  return typeof body?.link === "string" ? body.link : "";
}

export const googleSession = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ link: linkOf(input) }))
  .handler(async ({ data }) => {
    const { googleStatus } = await import("@/lib/google/photos.server");
    return googleStatus(data.link);
  });

export const googleAppStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { googleAppPublic } = await import("@/lib/google/photos.server");
  return googleAppPublic();
});

export const googleSaveApp = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { clientId?: unknown; clientSecret?: unknown; redirectUri?: unknown };
    return {
      clientId: typeof body?.clientId === "string" ? body.clientId : "",
      clientSecret: typeof body?.clientSecret === "string" ? body.clientSecret : "",
      redirectUri: typeof body?.redirectUri === "string" ? body.redirectUri : "",
    };
  })
  .handler(async ({ data }) => {
    const { saveGoogleApp } = await import("@/lib/google/photos.server");
    return saveGoogleApp(data);
  });

export const googleClearApp = createServerFn({ method: "POST" }).handler(async () => {
  const { clearGoogleApp } = await import("@/lib/google/photos.server");
  return clearGoogleApp();
});

export const googleTest = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ link: linkOf(input) }))
  .handler(async ({ data }) => {
    const { testGoogleDrive } = await import("@/lib/google/photos.server");
    return testGoogleDrive(data.link);
  });

export const googleDisconnect = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ link: linkOf(input) }))
  .handler(async ({ data }) => {
    const { disconnectGoogle } = await import("@/lib/google/photos.server");
    await disconnectGoogle(data.link);
    return { ok: true as const };
  });

export const googleUploadStart = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; mime?: unknown; size?: unknown; name?: unknown; link?: unknown };
    return {
      slug: typeof body.slug === "string" ? body.slug : "",
      mime: typeof body.mime === "string" ? body.mime : "",
      size: typeof body.size === "number" ? body.size : 0,
      name: typeof body.name === "string" ? body.name : "photo",
      link: typeof body.link === "string" ? body.link : "",
    };
  })
  .handler(async ({ data }) => {
    const { startUpload } = await import("@/lib/google/photos.server");
    return startUpload(data);
  });

export const openCircleMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; id?: unknown; intent?: unknown };
    return {
      slug: typeof body.slug === "string" ? body.slug : "",
      id: typeof body.id === "string" ? body.id : "",
      intent: body.intent === "download" ? ("download" as const) : ("view" as const),
    };
  })
  .handler(async ({ data }) => {
    const { openMedia } = await import("@/lib/google/photos.server");
    return openMedia(data.slug, data.id, data.intent);
  });

export const releaseCircleMedia = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { slug?: unknown; id?: unknown };
    return { slug: typeof body.slug === "string" ? body.slug : "", id: typeof body.id === "string" ? body.id : "" };
  })
  .handler(async ({ data }) => {
    const { releaseMedia } = await import("@/lib/google/photos.server");
    return releaseMedia(data.slug, data.id);
  });
