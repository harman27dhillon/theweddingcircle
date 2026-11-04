import assert from "node:assert/strict";
import test from "node:test";
import { deskPaneVisible, emptyDeskPanels, panelsFromRoute, readDeskPanels } from "./desk-layout.ts";

test("each desktop panel keeps its own section when the other side changes", () => {
  const start = emptyDeskPanels();
  const afterChat = panelsFromRoute(1, start);
  assert.deepEqual(afterChat, { left: 1, right: 2 });
  const afterAlbum = panelsFromRoute(3, afterChat);
  assert.deepEqual(afterAlbum, { left: 1, right: 3 });
  assert.deepEqual(panelsFromRoute(-1, afterAlbum), afterAlbum);
  assert.equal(deskPaneVisible(1, true, 3, afterAlbum), true);
  assert.equal(deskPaneVisible(0, true, 3, afterAlbum), false);
  assert.equal(deskPaneVisible(3, true, 1, afterAlbum), true);
  assert.equal(deskPaneVisible(2, true, 1, afterAlbum), false);
  assert.equal(deskPaneVisible(1, false, 1, afterAlbum), true);
  assert.equal(deskPaneVisible(3, false, 1, afterAlbum), false);
});

test("a saved desktop panel pair ignores a broken value", () => {
  assert.deepEqual(readDeskPanels(JSON.stringify({ left: 1, right: 4 })), { left: 1, right: 4 });
  assert.equal(readDeskPanels(JSON.stringify({ left: 3, right: 4 })), null);
  assert.equal(readDeskPanels("nope"), null);
  assert.equal(readDeskPanels(null), null);
});
