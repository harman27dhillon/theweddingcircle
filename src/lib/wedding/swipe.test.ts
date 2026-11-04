import assert from "node:assert/strict";
import test from "node:test";
import { nextSwipeIndex } from "./swipe.ts";

test("horizontal swipes move one section and vertical drags stay put", () => {
  assert.equal(nextSwipeIndex(0, -80, 4, 120), 1);
  assert.equal(nextSwipeIndex(2, 90, -6, 140), 1);
  assert.equal(nextSwipeIndex(0, 80, 4, 100), 0);
  assert.equal(nextSwipeIndex(4, -70, 2, 100), 4);
  assert.equal(nextSwipeIndex(1, -20, 80, 200), 1);
  assert.equal(nextSwipeIndex(1, -40, 8, 40), 2);
});
