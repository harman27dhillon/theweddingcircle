import assert from "node:assert/strict";
import test from "node:test";
import { DRIVE_CHUNK, DRIVE_FILE_SCOPE, DRIVE_SCOPES, contentRangeHeader, driveStatusError } from "./drive.ts";

test("drive setup asks only for files this app creates or the person opens", () => {
  assert.equal(DRIVE_SCOPES.includes("photoslibrary"), false);
  assert.equal(DRIVE_SCOPES.includes("drive.readonly"), false);
  assert.equal(DRIVE_SCOPES.includes("auth/drive "), false);
  assert.equal(DRIVE_SCOPES.includes(DRIVE_FILE_SCOPE), true);
  assert.equal(DRIVE_SCOPES.includes("openid"), true);
});

test("drive upload chunks stay on the 256 KiB boundary", () => {
  assert.equal(DRIVE_CHUNK % (256 * 1024), 0);
  assert.equal(contentRangeHeader(0, DRIVE_CHUNK, DRIVE_CHUNK * 2), `bytes 0-${DRIVE_CHUNK - 1}/${DRIVE_CHUNK * 2}`);
  assert.equal(contentRangeHeader(DRIVE_CHUNK, 100, DRIVE_CHUNK + 100), `bytes ${DRIVE_CHUNK}-${DRIVE_CHUNK + 99}/${DRIVE_CHUNK + 100}`);
});

test("drive errors stay specific and do not invent a connection", () => {
  assert.match(driveStatusError(401), /expired/i);
  assert.match(driveStatusError(403), /permission/i);
  assert.match(driveStatusError(404), /Google Photos/);
  assert.match(driveStatusError(500), /did not answer/i);
  assert.equal(driveStatusError(200).includes("ya29."), false);
});
