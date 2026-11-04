import assert from "node:assert/strict";
import test from "node:test";
import { playbackBadge, watchTiles, youtubePlayerMessage } from "./live-layout.ts";

test("the live stage is one slot and never a multi-stream grid", () => {
  const empty = watchTiles([], "");
  assert.equal(empty.length, 1);
  assert.equal(empty[0]?.kind, "empty");
  assert.deepEqual(watchTiles(["a", "b"], "").map((tile) => tile.kind), ["camera"]);
  assert.equal(watchTiles(["a", "b"], "")[0]?.id, "a");
  assert.equal(watchTiles(["a"], "abcdefghijk").some((tile) => tile.kind === "youtube"), false);
  assert.equal(watchTiles([], "abcdefghijk").some((tile) => tile.kind === "youtube"), false);
  const self = watchTiles(["a", "b", "c", "d"], "abcdefghijk", true);
  assert.equal(self.length, 1);
  assert.equal(self[0]?.kind, "self");
});

test("a failed or unfinished connection is not labelled live", () => {
  assert.equal(playbackBadge("live").live, true);
  assert.equal(playbackBadge("connecting").live, false);
  assert.equal(playbackBadge("reconnecting").live, false);
  assert.equal(playbackBadge("failed").text, "Couldn't connect");
});

test("youtube player errors stay specific and are not called live", () => {
  assert.match(youtubePlayerMessage(150), /not allowing/);
  assert.match(youtubePlayerMessage(100), /unavailable/);
  assert.match(youtubePlayerMessage(5), /browser/);
  assert.equal(youtubePlayerMessage(150).toLowerCase().includes("live"), false);
});
