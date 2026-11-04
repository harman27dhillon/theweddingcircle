import assert from "node:assert/strict";
import test from "node:test";
import { freshTheme, isCustomClassicId, sanitizeAppearance, sanitizeTheme } from "./classic-maker.ts";

test("custom classic themes cannot replace built-in themes or carry a wedding id", () => {
  assert.equal(sanitizeTheme({ id: "classic-default", name: "Classic Default", colors: {}, images: {} }), null);
  assert.equal(sanitizeTheme({ id: "classic-custom-abcd1234", name: "Garden", weddingId: "w1" }), null);
  const theme = sanitizeTheme({ id: "classic-custom-abcd1234", name: "Garden Classic", colors: { page: "red", text: "#112233" } });
  assert.equal(theme?.colors.page, "#f4efe8");
  assert.equal(theme?.colors.text, "#112233");
  assert.equal(isCustomClassicId(theme?.id || ""), true);
});

test("rose garden stays a bundled mobile landing asset", () => {
  const parsed = sanitizeAppearance({
    mobileLanding: { src: "/assets/developer/landing/rose-garden.png", fit: "cover", position: "center", bundled: true },
    themes: [],
  });
  assert.equal(parsed.mobileLanding?.src, "/assets/developer/landing/rose-garden.png");
  assert.equal(parsed.mobileLanding?.fit, "cover");
  assert.equal(parsed.mobileLanding?.bundled, true);
});
test("appearance drops data urls and keeps only project asset paths", () => {
  const parsed = sanitizeAppearance({
    mobileLanding: { src: "data:image/jpeg;base64,aaaa", fit: "cover", position: "center", bundled: true },
    themes: [freshTheme("One"), { id: "nope", name: "Bad" }],
  });
  assert.equal(parsed.mobileLanding, null);
  assert.equal(parsed.themes.length, 1);
  assert.equal(parsed.themes[0]?.name, "One");
});

test("desktop and ceremony backgrounds accept library paths and reject remote urls", () => {
  const parsed = sanitizeAppearance({
    mobileLanding: { src: "/assets/developer/landing/rose-garden.png", fit: "cover", position: "center", bundled: true },
    landingBackground: { src: "/media/cover.jpg", fit: "cover", position: "center", bundled: true },
    ceremonyBackground: { src: "/covers/sunset.svg", fit: "contain", position: "top", bundled: false },
    themes: [],
  });
  assert.equal(parsed.landingBackground?.src, "/media/cover.jpg");
  assert.equal(parsed.ceremonyBackground?.src, "/covers/sunset.svg");
  assert.equal(parsed.mobileLanding?.src, "/assets/developer/landing/rose-garden.png");
  const rejected = sanitizeAppearance({
    landingBackground: { src: "https://example.com/a.jpg", fit: "cover", position: "center" },
    ceremonyBackground: { src: "data:image/png;base64,aaaa", fit: "cover", position: "center" },
  });
  assert.equal(rejected.landingBackground, null);
  assert.equal(rejected.ceremonyBackground, null);
});
