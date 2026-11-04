import assert from "node:assert/strict";
import test from "node:test";
import { cameraDrawPlan, cameraFailure, cameraLabelMatches, canReadPrivateMedia, chooseBakeTurn, chooseCameraId, clock, composerFieldHeight, fitFrame, frameCrop, frameNeedsPortraitTurn, microphoneFailure, preferredMime, voiceAttachment } from "./capture.ts";

test("camera and microphone failures stay specific", () => {
  assert.match(cameraFailure(new DOMException("no", "NotAllowedError")), /blocked/);
  assert.match(cameraFailure(new DOMException("no", "NotFoundError")), /no camera/);
  assert.match(cameraFailure(new DOMException("no", "NotReadableError")), /already in use/);
  assert.match(cameraFailure(new DOMException("slow", "TimeoutError")), /too long/);
  assert.match(microphoneFailure(new DOMException("no", "NotAllowedError")), /microphone was blocked/);
  assert.equal(cameraFailure(new Error("other")), "The camera could not start.");
});

test("voice notes keep a storage reference, not a raw recording", () => {
  assert.equal(voiceAttachment({ src: "data:audio/webm;base64,AAAA", seconds: 3 }), undefined);
  assert.equal(voiceAttachment({ src: "blob:http://local/1", seconds: 3 }), undefined);
  assert.equal(voiceAttachment({ src: "idb:abc", seconds: 0 }), undefined);
  assert.deepEqual(voiceAttachment({ src: "idb:abc", seconds: 4.2 }), { src: "idb:abc", seconds: 4 });
});

test("private audio requires a host key or a member key", () => {
  assert.equal(canReadPrivateMedia("image/jpeg", { editMatch: false, memberMatch: false }), true);
  assert.equal(canReadPrivateMedia("audio/webm", { editMatch: false, memberMatch: false }), false);
  assert.equal(canReadPrivateMedia("audio/mp4", { editMatch: true, memberMatch: false }), true);
  assert.equal(canReadPrivateMedia("audio/webm", { editMatch: false, memberMatch: true }), true);
});

test("recorder picks a supported type and the clock stays compact", () => {
  assert.equal(preferredMime("audio", (type) => type === "audio/mp4"), "audio/mp4");
  assert.equal(preferredMime("video", () => false), "");
  assert.equal(clock(65), "1:05");
});

test("portrait capture bakes a quarter turn into landscape sensor frames", () => {
  assert.equal(frameNeedsPortraitTurn(1920, 1080, true), true);
  assert.equal(frameNeedsPortraitTurn(1080, 1920, true), false);
  assert.equal(frameNeedsPortraitTurn(1920, 1080, false), false);
  const rear = cameraDrawPlan(1920, 1080, "environment", true);
  assert.deepEqual({ outWidth: rear.outWidth, outHeight: rear.outHeight, turned: rear.turned }, { outWidth: 1080, outHeight: 1920, turned: true });
  assert.equal(rear.radians, Math.PI / 2);
  const front = cameraDrawPlan(1920, 1080, "user", true);
  assert.equal(front.radians, -Math.PI / 2);
  assert.equal(front.mirror, true);
  const upright = cameraDrawPlan(1080, 1920, "user", true);
  assert.equal(upright.turned, false);
  assert.equal(upright.outWidth, 1080);
  assert.equal(upright.outHeight, 1920);
});

test("portrait bake trusts a reported quarter turn and does not invent one for an upright frame", () => {
  assert.equal(chooseBakeTurn(1920, 1080, "environment", true, null), 90);
  assert.equal(chooseBakeTurn(1920, 1080, "user", true, null), 270);
  assert.equal(chooseBakeTurn(1080, 1920, "environment", true, null), 0);
  assert.equal(chooseBakeTurn(1920, 1080, "environment", true, 0), 90);
  assert.equal(chooseBakeTurn(1080, 1920, "user", true, 90), 90);
  assert.equal(chooseBakeTurn(1920, 1080, "environment", false, 90), 0);
  assert.equal(composerFieldHeight(240, "a long note"), 128);
  assert.equal(composerFieldHeight(40, "hi"), 40);
  assert.equal(composerFieldHeight(240, ""), 0);
});
test("photo frame crops the cover preview without stretching", () => {
  const full = fitFrame(90, 160, 9, 16);
  assert.equal(Math.round(full.width), 90);
  assert.equal(Math.round(full.height), 160);
  const square = fitFrame(90, 160, 1, 1);
  assert.equal(Math.round(square.width), 90);
  assert.equal(Math.round(square.height), 90);
  const same = frameCrop(900, 1600, 90, 160, 9, 16);
  assert.ok(Math.abs(same.x) < 0.01 && Math.abs(same.y) < 0.01);
  assert.ok(Math.abs(same.width - 900) < 0.01 && Math.abs(same.height - 1600) < 0.01);
  const center = frameCrop(1000, 1000, 100, 200, 1, 1);
  assert.ok(Math.abs(center.width - center.height) < 0.01);
  assert.ok(center.x > 200 && center.y > 200);
});

test("camera switch prefers the other labeled lens and never the open one", () => {
  const cameras = [
    { deviceId: "rear", label: "camera2 0, facing back" },
    { deviceId: "front", label: "camera2 1, facing front" },
  ];
  assert.equal(cameraLabelMatches("camera2 0, facing back", "environment"), true);
  assert.equal(cameraLabelMatches("camera2 0, facing back", "user"), false);
  assert.equal(chooseCameraId(cameras, "environment", "front"), "rear");
  assert.equal(chooseCameraId(cameras, "user", "rear"), "front");
  assert.equal(chooseCameraId([{ deviceId: "only", label: "" }], "environment", "only"), "");
  assert.equal(chooseCameraId([{ deviceId: "a", label: "" }, { deviceId: "b", label: "" }], "user", "a"), "b");
});
