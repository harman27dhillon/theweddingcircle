import { createServerFn } from "@tanstack/react-start";

export const importDiscoverHtml = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const url = typeof (input as { url?: unknown } | null)?.url === "string" ? (input as { url: string }).url.slice(0, 2000) : "";
    return { url };
  })
  .handler(async ({ data }) => {
    const { importHtmlImages } = await import("./html-import.server");
    return importHtmlImages(data.url);
  });
