import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CARD_THEMES } from "./card-themes.ts";
import { cleanMusicData, cleanMusicTitle, MUSIC_LIMIT, MUSIC_MAX_BYTES } from "./music-library.ts";
import { themeTrack } from "./theme-music.ts";

const publicDir = fileURLToPath(new URL("../../../public/theme-music/", import.meta.url));
const removed = ["piano-strings.wav", "indian-ambience.wav", "celebration.wav", "intimate-evening.wav", "cinematic.wav"];

test("themes do not assign built-in music", () => {
  assert.equal(themeTrack(null), null);
  assert.equal(themeTrack("missing-theme"), null);
  for (const theme of CARD_THEMES) assert.equal(themeTrack(theme.id), null);
  for (const name of removed) assert.equal(existsSync(join(publicDir, name)), false, name);
});

test("music uploads accept real audio and reject the wrong type or size", () => {
  assert.equal(MUSIC_LIMIT >= 10, true);
  assert.equal(cleanMusicTitle("  Evening   raga "), "Evening raga");
  assert.equal(cleanMusicTitle("   "), "");
  const wav = Buffer.alloc(64);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(56, 4);
  wav.write("WAVE", 8);
  const ok = cleanMusicData("audio/wav", wav.toString("base64"));
  assert.equal("error" in ok, false);
  if (!("error" in ok)) assert.equal(ok.bytes, 64);
  const mp3 = Buffer.alloc(64);
  mp3.write("ID3", 0);
  const tagged = cleanMusicData("audio/mp3", mp3.toString("base64"));
  assert.equal("error" in tagged, false);
  const m4a = Buffer.alloc(32);
  m4a.write("ftyp", 4);
  const boxed = cleanMusicData("audio/x-m4a", m4a.toString("base64"));
  assert.equal("error" in boxed, false);
  const fake = cleanMusicData("audio/mpeg", Buffer.from("not-audio-bytes-here!!").toString("base64"));
  assert.equal("error" in fake, true);
  const png = cleanMusicData("image/png", wav.toString("base64"));
  assert.equal("error" in png, true);
  const big = Buffer.alloc(MUSIC_MAX_BYTES + 8);
  big.write("RIFF", 0);
  big.write("WAVE", 8);
  const over = cleanMusicData("audio/wav", big.toString("base64"));
  assert.equal("error" in over, true);
  if ("error" in over) assert.match(over.error, /1\.8 MB/);
});
