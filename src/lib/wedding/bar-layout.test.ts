import assert from "node:assert/strict";
import test from "node:test";
import { frameForTheme, parkLegacyFrame, sanitizeBar } from "./bar-layout.ts";

test("wedding bar layout keeps a cover and clamped positions", () => {
  const bar = sanitizeBar({
    cover: "/covers/sage.svg",
    names: { x: 2, y: 140 },
    date: { x: 40, y: 70 },
    place: { x: "no", y: 10 },
  });
  assert.equal(bar?.cover, "/covers/sage.svg");
  assert.deepEqual(bar?.names, { x: 8, y: 92 });
  assert.deepEqual(bar?.date, { x: 40, y: 70 });
  assert.equal(bar?.place, undefined);
});

test("wedding bar framing stays on the cover and does not require text positions", () => {
  const bar = sanitizeBar({ frame: { x: -10, y: 140, zoom: 9 }, names: { x: 28, y: 36 } });
  assert.deepEqual(bar?.frame, { x: 0, y: 100, zoom: 3 });
  assert.deepEqual(bar?.names, { x: 28, y: 36 });
  assert.equal(sanitizeBar({ frame: { x: "no", y: 10, zoom: 1 } }), undefined);
});

test("wedding bar layout rejects unknown covers and empty drafts", () => {
  assert.equal(sanitizeBar({ cover: "javascript:alert(1)" }), undefined);
  assert.equal(sanitizeBar({}), undefined);
  assert.equal(sanitizeBar(null), undefined);
});

test("cover crops stay on the theme that was framed", () => {
  const bar = sanitizeBar({
    names: { x: 28, y: 36 },
    frames: {
      "classic-sunset-romance": { x: 12, y: 20, zoom: 2 },
      "classic-celestial-ivory": { x: 80, y: 40, zoom: 1.4 },
      "not a theme": { x: 10, y: 10, zoom: 1 },
    },
  });
  assert.deepEqual(frameForTheme(bar, "classic-sunset-romance", "classic-celestial-ivory"), { x: 12, y: 20, zoom: 2 });
  assert.deepEqual(frameForTheme(bar, "classic-celestial-ivory", "classic-sunset-romance"), { x: 80, y: 40, zoom: 1.4 });
  assert.equal(frameForTheme(bar, "classic-crimson-sunset", "classic-sunset-romance"), undefined);
  assert.deepEqual(bar?.names, { x: 28, y: 36 });
  const parked = parkLegacyFrame(sanitizeBar({ frame: { x: 15, y: 25, zoom: 2 }, names: { x: 28, y: 36 } }), "classic-sunset-romance");
  assert.equal(parked?.frame, undefined);
  assert.deepEqual(parked?.frames?.["classic-sunset-romance"], { x: 15, y: 25, zoom: 2 });
  assert.equal(frameForTheme(parked, "classic-celestial-ivory", "classic-celestial-ivory"), undefined);
  assert.deepEqual(parked?.names, { x: 28, y: 36 });
});
