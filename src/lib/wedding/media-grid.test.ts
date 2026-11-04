import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mediaGridPlan } from "./media-grid.ts";
import { needsOwnedPickerBytes, sniffMediaType } from "./picker-file.ts";

test("chat grids stay square and collapse past four files into a +N tile", () => {
  assert.deepEqual(mediaGridPlan(1), { mode: "1", columns: 1, cells: 1, extra: 0 });
  assert.deepEqual(mediaGridPlan(2), { mode: "2", columns: 2, cells: 2, extra: 0 });
  assert.deepEqual(mediaGridPlan(3), { mode: "3", columns: 3, cells: 3, extra: 0 });
  assert.deepEqual(mediaGridPlan(4), { mode: "4", columns: 2, cells: 4, extra: 0 });
  assert.equal(mediaGridPlan(5).extra, 2);
  assert.equal(mediaGridPlan(6).extra, 3);
  assert.equal(mediaGridPlan(6).cells, 4);
  assert.equal(mediaGridPlan(10).extra, 7);
  assert.equal(mediaGridPlan(10).cells, 4);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const grid = css.slice(css.indexOf(".media-grid {"));
  assert.match(grid, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(grid, /object-fit:\s*cover/);
  assert.match(grid, /var\(--wc-sent/);
  assert.match(grid, /var\(--wc-received/);
  assert.equal(grid.includes("#8c2f39"), false);
});

test("only Android Chrome must copy a picker file, and a missing type can still be recognised", () => {
  const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  const samsung = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";
  const desktop = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  assert.equal(needsOwnedPickerBytes(chrome), true);
  assert.equal(needsOwnedPickerBytes(samsung), false);
  assert.equal(needsOwnedPickerBytes(desktop), false);
  assert.equal(sniffMediaType("", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), "image/jpeg");
  assert.equal(sniffMediaType("", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  const heic = new Uint8Array(12);
  heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  assert.equal(sniffMediaType("", heic), "image/heic");
  const mp4 = new Uint8Array(12);
  mp4.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.equal(sniffMediaType("", mp4), "video/mp4");
  const feed = readFileSync(new URL("../../components/wedding/feed-screen.tsx", import.meta.url), "utf8");
  const pick = feed.slice(feed.lastIndexOf("ownPickerFiles"));
  assert.equal(pick.indexOf("ownPickerFiles") < pick.indexOf('value = ""'), true);
  assert.equal(pick.indexOf('value = ""') < pick.indexOf("onFiles"), true);
  const people = readFileSync(new URL("../../components/wedding/people-screen.tsx", import.meta.url), "utf8");
  const before = readFileSync(new URL("../../components/wedding/before-screen.tsx", import.meta.url), "utf8");
  assert.equal(people.includes("ownPickerFiles"), true);
  assert.equal(before.includes("ownPickerFiles"), true);
});
