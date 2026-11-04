import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CEREMONY_COVERS, GENERIC_CEREMONY_COVER, ceremonyCoverFor, matchCeremonyName } from "./ceremony-covers.ts";

const classic = [
  "classic-default",
  "classic-ivory",
  "classic-sunset-romance",
  "classic-celestial-ivory",
  "classic-crimson-sunset",
  "classic-marigold-palace",
  "classic-rose-bridal",
  "classic-royal-lakeside",
  "classic-custom-ab12cd34",
] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("henna names resolve to the mehndi cover", () => {
  for (const name of ["Mehndi", "Mehendi", "Mehandi", "Henna Ceremony", "Henna Night", "Hina", "Laylat al-Henna", "Kına Gecesi", "Maruthani", "Mailanchi"]) {
    const match = matchCeremonyName(name);
    assert.ok(match && "kind" in match, name);
    assert.equal(match.kind, "mehndi", name);
    assert.equal(ceremonyCoverFor({ name }, "classic-default"), CEREMONY_COVERS.mehndi, name);
  }
  assert.equal(matchCeremonyName("Anand"), null);
  assert.equal(ceremonyCoverFor({ name: "Anand" }, "classic-ivory"), GENERIC_CEREMONY_COVER);
  assert.equal(ceremonyCoverFor({ name: "Wedding ceremony" }, "classic-default"), GENERIC_CEREMONY_COVER);
  assert.equal(ceremonyCoverFor({ name: "Dinner" }, "classic-rose-bridal"), GENERIC_CEREMONY_COVER);
});

test("each ceremony keeps its own picture", () => {
  const cases: [string, keyof typeof CEREMONY_COVERS][] = [
    ["Haldi", "haldi"],
    ["Pithi", "haldi"],
    ["Roka", "engagement"],
    ["Sagai", "engagement"],
    ["Baraat", "baraat"],
    ["Jaggo", "jaggo"],
    ["Goan Sangeet", "sangeet"],
    ["Chooda", "chooda"],
    ["Chura ceremony", "chooda"],
    ["Shagun", "shagun"],
    ["Sagun", "shagun"],
    ["Nikah", "nikah"],
    ["Katb al-Kitab", "nikah"],
    ["Anand Karaj", "anand-karaj"],
    ["Laavan", "anand-karaj"],
    ["Paath", "paath"],
    ["Akhand Paath", "paath"],
    ["Church ceremony", "church"],
    ["Saat Phere", "phere"],
    ["Walima", "walima"],
    ["Reception", "reception"],
    ["Doli", "doli"],
    ["Vidaai", "doli"],
    ["Rukhsati", "doli"],
  ];
  for (const [name, kind] of cases) {
    const match = matchCeremonyName(name);
    assert.ok(match && "kind" in match, name);
    assert.equal(match.kind, kind, name);
    assert.equal(ceremonyCoverFor({ name }, "classic-crimson-sunset"), CEREMONY_COVERS[kind], name);
  }
  const files = [...Object.values(CEREMONY_COVERS), GENERIC_CEREMONY_COVER];
  assert.equal(new Set(files).size, files.length);
  for (const src of files) assert.equal(existsSync(join(root, "public", src.slice(1))), true, src);
});

test("classic themes use the mapping and preset themes do not", () => {
  for (const themeId of classic) {
    assert.equal(ceremonyCoverFor({ name: "Mehndi" }, themeId), CEREMONY_COVERS.mehndi, themeId);
    assert.equal(ceremonyCoverFor({ name: "Nikah" }, themeId), CEREMONY_COVERS.nikah, themeId);
    assert.equal(ceremonyCoverFor({ name: "Anand Karaj" }, themeId), CEREMONY_COVERS["anand-karaj"], themeId);
    assert.equal(ceremonyCoverFor({ name: "Doli" }, themeId), CEREMONY_COVERS.doli, themeId);
    assert.equal(ceremonyCoverFor({ name: "Vidaai" }, themeId), CEREMONY_COVERS.doli, themeId);
    assert.equal(ceremonyCoverFor({ name: "Shagun" }, themeId), CEREMONY_COVERS.shagun, themeId);
    assert.equal(ceremonyCoverFor({ name: "Paath" }, themeId), CEREMONY_COVERS.paath, themeId);
    assert.equal(ceremonyCoverFor({ name: "Haldi" }, themeId), CEREMONY_COVERS.haldi, themeId);
    assert.equal(ceremonyCoverFor({ name: "Welcome drinks" }, themeId), GENERIC_CEREMONY_COVER, themeId);
  }
  const presets = ["royal-burgundy", "pastel-blush", "rose-romance", "butterfly-romance", "moonlight-reverie"];
  for (const themeId of presets) {
    assert.equal(ceremonyCoverFor({ name: "Mehndi" }, themeId), null, themeId);
    assert.equal(ceremonyCoverFor({ name: "Nikah" }, themeId), null, themeId);
    assert.equal(ceremonyCoverFor({ name: "Welcome drinks" }, themeId), null, themeId);
  }
  const custom = `data:image/jpeg;base64,${"a".repeat(80)}`;
  assert.equal(ceremonyCoverFor({ name: "Mehndi", cover: custom }, "royal-burgundy"), custom);
  assert.equal(ceremonyCoverFor({ name: "Mehndi", coverKind: "none" }, "butterfly-romance"), null);
  assert.equal(ceremonyCoverFor({ name: "Mehndi", coverKind: "paath" }, "moonlight-reverie"), CEREMONY_COVERS.paath);
  assert.equal(ceremonyCoverFor({ name: "Mehndi" }, ""), null);
  assert.equal(ceremonyCoverFor({ name: "Mehndi" }, "not-a-theme"), null);
  assert.equal(ceremonyCoverFor({ name: "Nikah", cover: "data:image/jpeg;base64,abc" }, ""), null);
});

test("a custom cover stays on that ceremony and can be restored", () => {
  const custom = `data:image/jpeg;base64,${"a".repeat(80)}`;
  const mehndi = { name: "Mehndi", cover: custom };
  assert.equal(ceremonyCoverFor(mehndi, "classic-marigold-palace"), custom);
  assert.equal(ceremonyCoverFor({ ...mehndi, name: "Reception" }, "classic-ivory"), custom);
  assert.equal(ceremonyCoverFor({ name: "Nikah" }, "classic-default"), CEREMONY_COVERS.nikah);
  assert.equal(ceremonyCoverFor({ name: "Henna Night", coverKind: "none" }, "classic-sunset-romance"), null);
  assert.equal(ceremonyCoverFor({ name: "Welcome drinks", coverKind: "none" }, "classic-default"), null);
  assert.equal(ceremonyCoverFor({ name: "Dinner", coverKind: "doli" }, "classic-royal-lakeside"), CEREMONY_COVERS.doli);
  const stored = "idb:fac6e06f-3688-45e8-9660-11ad02f995ee";
  assert.equal(ceremonyCoverFor({ name: "Reception", cover: stored }, "classic-default"), stored);
  assert.equal(ceremonyCoverFor({ name: "Garden lunch", cover: "idb:not-valid" }, "classic-ivory"), GENERIC_CEREMONY_COVER);
});

test("a name that matches two ceremonies is not given a picture", () => {
  assert.deepEqual(matchCeremonyName("Mehndi and Nikah"), { ambiguous: true });
  assert.deepEqual(matchCeremonyName("Walima reception"), { ambiguous: true });
  assert.equal(ceremonyCoverFor({ name: "Mehndi and Doli" }, "classic-celestial-ivory"), null);
  assert.equal(ceremonyCoverFor({ name: "Mehndi and Doli", coverKind: "mehndi" }, "classic-default"), CEREMONY_COVERS.mehndi);
});
