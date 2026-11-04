import assert from "node:assert/strict";
import test from "node:test";
import { FONT_ROLES, WEDDING_FONTS, fontsFromRemote, sanitizeFonts } from "./fonts.ts";

test("wedding font catalog is a real whitelist of 50 or more", () => {
  assert.ok(WEDDING_FONTS.length >= 50);
  assert.equal(new Set(WEDDING_FONTS.map((font) => font.id)).size, WEDDING_FONTS.length);
  assert.equal(new Set(WEDDING_FONTS.map((font) => font.family)).size, WEDDING_FONTS.length);
  assert.deepEqual(FONT_ROLES.map((role) => role.id), ["names", "ceremonyHead", "ceremonyBody", "headings", "body"]);
  const clean = sanitizeFonts({ names: "great-vibes", body: "not-a-font", headings: "cinzel" });
  assert.equal(clean?.names, "great-vibes");
  assert.equal(clean?.headings, "cinzel");
  assert.equal(clean?.body, undefined);
  assert.equal(fontsFromRemote({ fonts: { names: "lora", body: "outfit" } }, {})?.names, "lora");
  assert.deepEqual(fontsFromRemote({ fonts: { names: "lora" } }, { fonts: {} }), {});
  assert.equal(fontsFromRemote({ fonts: { names: "lora", body: "outfit" } }, { fonts: { ceremonyHead: "playfair-display" } })?.ceremonyHead, "playfair-display");
  assert.equal(fontsFromRemote({ fonts: { names: "lora" } }, { fonts: { ceremonyHead: "playfair-display" } })?.names, undefined);
});
