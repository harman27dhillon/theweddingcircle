import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src/", import.meta.url).pathname },
});

test("countdown uses local midnight of the wedding date and never goes negative", async () => {
  const { weddingCountdown } = await jiti.import("../src/lib/wedding/format.ts");
  const target = new Date(2031, 5, 20, 0, 0, 0, 0);
  const now = new Date(2031, 5, 18, 21, 30, 10, 0);
  const parts = weddingCountdown("2031-06-20", now.getTime());
  assert.equal(parts.done, false);
  const total = Math.floor((target.getTime() - now.getTime()) / 1000);
  assert.equal(parts.days, Math.floor(total / 86400));
  assert.equal(parts.hours, Math.floor((total % 86400) / 3600));
  assert.equal(parts.minutes, Math.floor((total % 3600) / 60));
  assert.equal(parts.seconds, total % 60);
  assert.ok(parts.days >= 0 && parts.hours >= 0 && parts.minutes >= 0 && parts.seconds >= 0);
  assert.equal(weddingCountdown("2031-06-20", target.getTime()).done, true);
  assert.equal(weddingCountdown("2031-06-20", target.getTime() + 5000).done, true);
  assert.equal(weddingCountdown("", now.getTime()), null);
  assert.equal(weddingCountdown("not-a-date", now.getTime()), null);
});
