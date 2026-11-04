import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCardRatio, cardDisplayFromConfig, cardRatioChoice, resolveCardRatio } from "./card-ratio.ts";

test("presets stay independent of the original card and reject unsafe custom ratios", () => {
  assert.equal(canonicalCardRatio(""), "original");
  assert.equal(canonicalCardRatio("original"), "original");
  assert.equal(canonicalCardRatio("3:4"), "3:4");
  assert.equal(canonicalCardRatio("9:16"), "9:16");
  assert.equal(canonicalCardRatio("1:1"), "1:1");
  assert.equal(canonicalCardRatio("4:3"), "4:3");
  assert.equal(canonicalCardRatio("16:9"), "16:9");
  assert.equal(canonicalCardRatio("custom:3:5"), "custom:3:5");
  assert.equal(canonicalCardRatio("custom:2.5:4"), "custom:2.5:4");
  assert.equal(canonicalCardRatio("17:9"), null);
  assert.equal(canonicalCardRatio("custom:1:100"), null);
  assert.equal(canonicalCardRatio("custom:0:4"), null);
  assert.equal(canonicalCardRatio("custom:abc:4"), null);
  assert.equal(cardRatioChoice("custom", 3, 5), "custom:3:5");
  assert.equal(cardRatioChoice("16:9", 1, 1), "16:9");
  assert.equal(resolveCardRatio("16:9").w / resolveCardRatio("16:9").h, 16 / 9);
  assert.equal(resolveCardRatio("nope").original, true);
});

test("landing and pinned display settings do not share a value", () => {
  const display = cardDisplayFromConfig({
    cards: { landing: "4:3", pinned: "9:16", pinnedFull: true },
  });
  assert.equal(display.landing.id, "4:3");
  assert.equal(display.pinned.id, "9:16");
  assert.equal(display.pinnedFull, true);
  assert.notEqual(display.landing.w / display.landing.h, display.pinned.w / display.pinned.h);
  const fallback = cardDisplayFromConfig(null);
  assert.equal(fallback.landing.original, true);
  assert.equal(fallback.landingDesktop.original, true);
  assert.equal(fallback.pinned.original, true);
  assert.equal(fallback.pinnedFull, false);
});

test("desktop and mobile landing ratios stay independent", () => {
  const display = cardDisplayFromConfig({
    cards: { landing: "3:4", landingDesktop: "16:9", pinned: "1:1", pinnedFull: false },
  });
  assert.equal(display.landing.id, "3:4");
  assert.equal(display.landingDesktop.id, "16:9");
  assert.notEqual(display.landing.w / display.landing.h, display.landingDesktop.w / display.landingDesktop.h);
  const kept = cardDisplayFromConfig({ cards: { landing: "4:3", pinned: "9:16", pinnedFull: true } });
  assert.equal(kept.landing.id, "4:3");
  assert.equal(kept.landingDesktop.original, true);
  assert.equal(kept.pinned.id, "9:16");
  assert.equal(cardDisplayFromConfig({ cards: { pinned: "9:16", pinnedBar: "16:9" } }).pinnedBar.id, "16:9");
  assert.equal(cardDisplayFromConfig({ cards: { pinned: "9:16" } }).pinnedBar.original, true);
});
