import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const libraryCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { publicLibrary } = await import("@/lib/wedding/library.server");
  return publicLibrary();
});

export const developerLibraryList = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ token: text((input as { token?: unknown })?.token, 200) }))
  .handler(async ({ data }) => {
    const { developerLibrary } = await import("@/lib/wedding/library.server");
    return developerLibrary(data.token);
  });

export const developerLibraryCreate = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; name?: unknown; category?: unknown; mime?: unknown; data?: unknown };
    return {
      token: text(body?.token, 200),
      name: text(body?.name, 80),
      category: text(body?.category, 40),
      mime: text(body?.mime, 40),
      data: text(body?.data, 900_000),
    };
  })
  .handler(async ({ data }) => {
    const { createLibraryAsset } = await import("@/lib/wedding/library.server");
    return createLibraryAsset(data.token, data.name, data.category, data.mime, data.data);
  });

export const developerLibraryReplace = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; mime?: unknown; data?: unknown };
    return {
      token: text(body?.token, 200),
      id: text(body?.id, 80),
      mime: text(body?.mime, 40),
      data: text(body?.data, 900_000),
    };
  })
  .handler(async ({ data }) => {
    const { replaceLibraryAsset } = await import("@/lib/wedding/library.server");
    return replaceLibraryAsset(data.token, data.id, data.mime, data.data);
  });

export const developerLibraryActive = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; active?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80), active: body?.active === true };
  })
  .handler(async ({ data }) => {
    const { setLibraryAssetActive } = await import("@/lib/wedding/library.server");
    return setLibraryAssetActive(data.token, data.id, data.active);
  });

export const developerLibraryRename = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; name?: unknown; category?: unknown };
    return {
      token: text(body?.token, 200),
      id: text(body?.id, 80),
      name: text(body?.name, 80),
      category: text(body?.category, 40),
    };
  })
  .handler(async ({ data }) => {
    const { renameLibraryAsset } = await import("@/lib/wedding/library.server");
    return renameLibraryAsset(data.token, data.id, data.name, data.category);
  });

export const developerLibraryDelete = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; id?: unknown; confirm?: unknown };
    return { token: text(body?.token, 200), id: text(body?.id, 80), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { deleteLibraryAsset } = await import("@/lib/wedding/library.server");
    return deleteLibraryAsset(data.token, data.id, data.confirm);
  });

export const developerSampleCoverSave = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; mime?: unknown; data?: unknown };
    return { token: text(body?.token, 200), mime: text(body?.mime, 40), data: text(body?.data, 900_000) };
  })
  .handler(async ({ data }) => {
    const { saveSampleCover } = await import("@/lib/wedding/library.server");
    return saveSampleCover(data.token, data.mime, data.data);
  });

export const developerSampleCoverClear = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const body = input as { token?: unknown; confirm?: unknown };
    return { token: text(body?.token, 200), confirm: body?.confirm === true };
  })
  .handler(async ({ data }) => {
    const { clearSampleCover } = await import("@/lib/wedding/library.server");
    return clearSampleCover(data.token, data.confirm);
  });
